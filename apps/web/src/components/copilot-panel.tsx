'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot, X, Send, Mic, MicOff, Volume2, VolumeX, ShieldCheck,
  Building2, MessageSquare, CheckCircle2, Circle, Loader2,
  AlertCircle, ChevronRight, BrainCircuit, Zap,
} from 'lucide-react';
import { apiClient, api, type Org } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  fromCache?: boolean;
}

interface PlanStep {
  label: string;
  agentName?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

interface TaskPlan {
  goal: string;
  steps: PlanStep[];
}

interface CopilotResponse {
  reply: string;
  language?: string;
  executed?: { action: string; result: unknown };
  needsConfirmation?: Record<string, unknown> & { action: string };
  estimatedCredits?: number | null;
  fromCache?: boolean;
  plan?: TaskPlan;
  navigate?: string;
}

interface RecentJob {
  id: string;
  type: string;
  status: string;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  project: { id: string; title: string };
}

// ── STT ────────────────────────────────────────────────────────────────────
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { [i: number]: { isFinal: boolean } & ArrayLike<{ transcript: string }> } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getBrowserRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

// ── Plan step icon ─────────────────────────────────────────────────────────
function StepIcon({ status }: { status: PlanStep['status'] }) {
  if (status === 'done') return <CheckCircle2 style={{ width: 15, height: 15, color: '#4ADE80', flexShrink: 0 }} />;
  if (status === 'running') return <Loader2 style={{ width: 15, height: 15, color: '#A78BFA', flexShrink: 0, animation: 'spin 1s linear infinite' }} />;
  if (status === 'failed') return <AlertCircle style={{ width: 15, height: 15, color: '#F87171', flexShrink: 0 }} />;
  return <Circle style={{ width: 15, height: 15, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />;
}

// ── Job status badge ───────────────────────────────────────────────────────
function JobBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: '#4ADE80', RUNNING: '#A78BFA', PENDING: '#FBBF24',
    QUEUED: '#FBBF24', FAILED: '#F87171', CANCELLED: 'rgba(255,255,255,.35)',
  };
  const color = colors[status] ?? 'rgba(255,255,255,.35)';
  return (
    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
  );
}

/**
 * Copilot — autonomous AI agent panel. Voice + text + task plans + navigation.
 * Server STT via /copilot/transcribe (Whisper/Google/Deepgram/Azure).
 * Falls back to browser SpeechRecognition when server STT is unavailable.
 */
export function CopilotPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CopilotResponse['needsConfirmation'] | null>(null);
  const [pendingEstimate, setPendingEstimate] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [currentPlan, setCurrentPlan] = useState<TaskPlan | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [serverStt, setServerStt] = useState<boolean | null>(null); // null = unknown
  // Live streaming transcript while recording
  const [liveTranscript, setLiveTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const conversationRef = useRef(false);
  const [lang, setLang] = useState<string>(() =>
    typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [billingOrgId, setBillingOrgId] = useState('');

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('cf:open-copilot', handler as EventListener);
    return () => window.removeEventListener('cf:open-copilot', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!open) return;
    api.orgs.mine()
      .then((r) => setOrgs(r.data))
      .catch(() => setOrgs([]));
    // Check if server STT is available
    apiClient.get('/copilot/stt-status')
      .then((r) => setServerStt((r.data as { available: boolean }).available))
      .catch(() => setServerStt(false));
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, busy, currentPlan]);

  // Poll recent jobs while panel is open
  useEffect(() => {
    if (!open || !showJobs) return;
    const fetch = () => {
      apiClient.get('/copilot/jobs?take=8')
        .then((r) => setRecentJobs((r.data as { data: RecentJob[] }).data))
        .catch(() => undefined);
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, [open, showJobs]);

  // ── TTS ───────────────────────────────────────────────────────────────────
  const speak = useCallback((text: string, replyLang?: string, onDone?: () => void) => {
    if (!speakReplies || typeof window === 'undefined' || !window.speechSynthesis) {
      onDone?.();
      return;
    }
    const target = replyLang ?? lang;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = target;
    const voices = window.speechSynthesis.getVoices();
    const prefix = target.split('-')[0]!.toLowerCase();
    const match = voices.find((v) => v.lang.toLowerCase() === target.toLowerCase())
      ?? voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
    if (match) utterance.voice = match;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => { setSpeaking(false); onDone?.(); };
    utterance.onerror = () => { setSpeaking(false); onDone?.(); };
    window.speechSynthesis.speak(utterance);
  }, [speakReplies, lang]);

  const startListeningRef = useRef<() => void>(() => undefined);

  // ── Chat send ─────────────────────────────────────────────────────────────
  const send = useCallback(async (text: string, confirmedCommand?: Record<string, unknown>) => {
    const nextMessages: ChatMessage[] = text
      ? [...messages, { role: 'user' as const, content: text }]
      : messages;
    if (text) setMessages(nextMessages);
    setInput('');
    setLiveTranscript('');
    setPending(null);
    setPendingEstimate(null);
    setBusy(true);
    try {
      const res = await apiClient.post('/copilot/chat', {
        messages: nextMessages.slice(-10),
        inputMode: conversationRef.current ? 'voice' : 'text',
        ...(confirmedCommand ? { confirmedCommand } : {}),
        ...(!confirmedCommand && pending ? { pendingCommand: pending } : {}),
        ...(billingOrgId ? { orgId: billingOrgId } : {}),
      });
      const data = res.data as CopilotResponse;
      setMessages((m) => [...m, { role: 'assistant', content: data.reply, fromCache: data.fromCache }]);
      if (data.needsConfirmation) {
        setPending(data.needsConfirmation);
        setPendingEstimate(data.estimatedCredits ?? null);
      }
      if (data.language) setLang(data.language);
      // Show task plan if returned
      if (data.plan) setCurrentPlan(data.plan);
      // Auto-navigate to relevant page
      if (data.navigate) router.push(data.navigate);
      speak(data.reply, data.language, () => {
        if (conversationRef.current) startListeningRef.current();
      });
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong: ${e.response?.data?.message ?? 'request failed'}` }]);
    } finally {
      setBusy(false);
    }
  }, [messages, speak, pending, billingOrgId, router]);

  // ── Server STT (MediaRecorder → /copilot/transcribe) ─────────────────────
  // listening is set optimistically by toggleMic BEFORE this is called.
  const startServerSTT = useCallback(async () => {
    if (typeof window === 'undefined') return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Permission denied or hardware unavailable — roll back optimistic state
      setListening(false);
      setMicError('Microphone permission denied');
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg';

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];
    setRecording(true);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      setRecording(false);
      setListening(false);
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      if (blob.size < 500) { setLiveTranscript(''); return; }

      setLiveTranscript('Transcribing…');
      try {
        const form = new FormData();
        form.append('audio', blob, `recording.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`);
        form.append('language', lang.split('-')[0]!);
        const { data } = await apiClient.post('/copilot/transcribe', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const text = (data as { text: string }).text?.trim() ?? '';
        if (text) {
          conversationRef.current = true;
          setLiveTranscript(text);
          void send(text);
        } else {
          setLiveTranscript('');
          conversationRef.current = false;
        }
      } catch {
        setLiveTranscript('Transcription failed — try again');
        conversationRef.current = false;
      }
    };

    recorder.start(250);
    window.speechSynthesis?.cancel();
  }, [lang, send]);

  const stopServerSTT = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  // ── Browser STT fallback ──────────────────────────────────────────────────
  // listening is set optimistically by toggleMic BEFORE this is called.
  const startBrowserSTT = useCallback(async () => {
    const rec = getBrowserRecognition();
    if (!rec) {
      setListening(false);
      setMicError('Voice not supported in this browser — use Chrome or Edge');
      return;
    }

    // Check existing permission state before touching SpeechRecognition.
    // SpeechRecognition's own prompt is a tiny address-bar icon that's easy
    // to miss or accidentally block; getUserMedia shows a proper dialog and
    // lets us give an actionable error when already blocked.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // release immediately — just needed the grant
    } catch (err) {
      setListening(false);
      conversationRef.current = false;
      const name = (err as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicError('Mic blocked — click the 🔒 icon in your address bar → allow microphone');
      } else if (name === 'NotFoundError') {
        setMicError('No microphone found — plug one in and try again');
      } else {
        setMicError('Could not access microphone — check your system settings');
      }
      return;
    }

    recognitionRef.current = rec;
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = 0; i < (e.results as unknown as { length: number }).length; i++) {
        const r = e.results[i]!;
        if ((r as { isFinal: boolean }).isFinal) finalText += r[0]!.transcript;
        else interim += r[0]!.transcript;
      }
      setLiveTranscript(finalText + interim);
      setInput(finalText + interim);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) {
        conversationRef.current = true;
        void send(finalText.trim());
      } else {
        conversationRef.current = false;
        setInput('');
        setLiveTranscript('');
      }
    };
    rec.onerror = (e) => {
      setListening(false);
      conversationRef.current = false;
      if (e.error === 'not-allowed') {
        setMicError('Mic blocked — click the 🔒 icon in your address bar → allow microphone');
      }
    };
    window.speechSynthesis?.cancel();
    try {
      rec.start();
    } catch {
      setListening(false);
      conversationRef.current = false;
      setMicError('Could not start microphone — try again');
    }
  }, [send, lang]);

  const startListening = useCallback(() => {
    setMicError(null);
    if (serverStt === true) void startServerSTT();
    else void startBrowserSTT();
  }, [serverStt, startServerSTT, startBrowserSTT]);
  startListeningRef.current = startListening;

  const toggleMic = useCallback(() => {
    if (listening || recording) {
      // STOP
      conversationRef.current = false;
      if (mediaRecorderRef.current) stopServerSTT();
      else recognitionRef.current?.stop();
      setListening(false);
      setRecording(false);
      return;
    }
    // START — set green immediately so the button responds at once
    setListening(true);
    setMicError(null);
    conversationRef.current = true;
    startListening();
  }, [listening, recording, startListening, stopServerSTT]);

  // Auto-clear mic errors after 3s
  useEffect(() => {
    if (!micError) return;
    const id = setTimeout(() => setMicError(null), 6000);
    return () => clearTimeout(id);
  }, [micError]);

  void setSpeakReplies; // speakReplies toggle preserved for future UI

  const close = useCallback(() => {
    conversationRef.current = false;
    if (mediaRecorderRef.current) stopServerSTT();
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
    setOpen(false);
    setShowChat(false);
    setShowJobs(false);
  }, [stopServerSTT]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {open && (
        <div
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in-cf"
          style={{ background: 'rgba(30,27,46,.14)', backdropFilter: 'blur(1.5px)' }}
        >
          <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-6 animate-pop-in">

            {/* Voice orb */}
            <div style={{ position: 'relative', width: '220px', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(139,92,246,.35)', animation: (listening || speaking) ? 'ripple 2.4s ease-out infinite' : 'none', opacity: (listening || speaking) ? 1 : 0, transition: 'opacity .4s' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(139,92,246,.25)', animation: (listening || speaking) ? 'ripple 2.4s ease-out 1.2s infinite' : 'none', opacity: (listening || speaking) ? 1 : 0, transition: 'opacity .4s' }} />
              <div
                style={{
                  position: 'relative', width: '132px', height: '132px', borderRadius: '50%',
                  background: speaking
                    ? 'linear-gradient(135deg,#7E62C9,#5B21B6)'
                    : 'linear-gradient(135deg,#9C88DD,#7E62C9)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                  animation: (busy || speaking) ? 'pulseGlow 2.4s ease-in-out infinite' : 'none',
                  boxShadow: (busy || speaking) ? undefined : '0 8px 24px -8px rgba(124,58,237,.5)',
                  transition: 'box-shadow .4s, background .4s',
                }}
              >
                {[
                  { h: '22px', d: '0s' }, { h: '44px', d: '.15s' }, { h: '64px', d: '.3s' }, { h: '40px', d: '.45s' },
                  { h: '70px', d: '.2s' }, { h: '36px', d: '.35s' }, { h: '20px', d: '.5s' },
                ].map((bar, i) => (
                  <span
                    key={i}
                    style={{
                      width: '6px',
                      height: (listening || speaking) ? bar.h : busy ? bar.h : '6px',
                      borderRadius: '6px',
                      background: speaking ? '#c4b5fd' : '#fff',
                      animation: (listening || speaking) ? `voiceBar 1s ease-in-out ${bar.d} infinite` : 'none',
                      transition: 'height .35s cubic-bezier(.4,0,.2,1)',
                      opacity: (listening || speaking) ? 1 : busy ? 0.6 : 0.35,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Status + live transcript */}
            <div style={{ textAlign: 'center' }}>
              <div
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#fff', background: 'rgba(30,27,46,.55)', backdropFilter: 'blur(6px)', padding: '9px 18px', borderRadius: '30px' }}
              >
                <span style={{
                  width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
                  background: micError ? '#F87171' : listening ? '#4ADE80' : speaking ? '#A78BFA' : busy ? '#FBBF24' : 'rgba(255,255,255,.45)',
                  boxShadow: micError ? '0 0 0 4px rgba(248,113,113,.25)' : listening ? '0 0 0 4px rgba(74,222,128,.25)' : speaking ? '0 0 0 4px rgba(167,139,250,.25)' : busy ? '0 0 0 4px rgba(251,191,36,.25)' : 'none',
                  transition: 'background .3s, box-shadow .3s',
                }} />
                {micError ? micError : listening ? 'Listening…' : speaking ? 'Speaking…' : busy ? 'Processing…' : 'Copilot ready'}
              </div>
              {/* Live transcript OR last message */}
              <p style={{ fontSize: '12.5px', color: 'rgba(30,27,46,.55)', fontWeight: 600, marginTop: '10px', maxWidth: '320px', textAlign: 'center' }}>
                {liveTranscript
                  ? liveTranscript.slice(0, 100) + (liveTranscript.length > 100 ? '…' : '')
                  : messages.length > 0
                    ? (messages[messages.length - 1]?.content ?? '').slice(0, 80) + ((messages[messages.length - 1]?.content?.length ?? 0) > 80 ? '…' : '')
                    : 'Ask me anything about your content'}
              </p>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="button"
                title={listening ? 'Stop listening' : 'Start listening'}
                onClick={(e) => { e.stopPropagation(); toggleMic(); }}
                style={{ width: '52px', height: '52px', borderRadius: '50%', background: listening ? '#4ADE80' : '#fff', color: listening ? '#fff' : '#6b6880', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', boxShadow: '0 10px 26px -12px rgba(30,27,46,.5)', transition: 'background .25s, color .25s' }}
              >
                {listening ? <MicOff style={{ width: '22px', height: '22px' }} /> : <Mic style={{ width: '22px', height: '22px' }} />}
              </button>

              <button
                type="button"
                title="Type a message"
                onClick={(e) => { e.stopPropagation(); setShowChat((c) => !c); setShowJobs(false); }}
                style={{ width: '52px', height: '52px', borderRadius: '50%', background: showChat ? '#7C3AED' : '#fff', color: showChat ? '#fff' : '#6b6880', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', boxShadow: '0 10px 26px -12px rgba(30,27,46,.5)', transition: 'background .25s, color .25s' }}
              >
                <MessageSquare style={{ width: '22px', height: '22px' }} />
              </button>

              <button
                type="button"
                title="Task queue"
                onClick={(e) => { e.stopPropagation(); setShowJobs((j) => !j); setShowChat(false); }}
                style={{ width: '52px', height: '52px', borderRadius: '50%', background: showJobs ? '#7C3AED' : '#fff', color: showJobs ? '#fff' : '#6b6880', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', boxShadow: '0 10px 26px -12px rgba(30,27,46,.5)', transition: 'background .25s, color .25s' }}
              >
                <Zap style={{ width: '22px', height: '22px' }} />
              </button>

              <button
                type="button"
                title="Close"
                onClick={(e) => { e.stopPropagation(); close(); }}
                style={{ width: '64px', height: '64px', borderRadius: '50%', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#F87171,#EF4444)', boxShadow: '0 12px 30px -12px rgba(239,68,68,.7)' }}
              >
                <X style={{ width: '26px', height: '26px' }} />
              </button>
            </div>

            {/* Text input */}
            {showChat && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: '400px', maxWidth: 'calc(100vw - 3rem)', background: '#fff', borderRadius: '16px', padding: '12px', display: 'flex', gap: '8px', boxShadow: '0 20px 50px -20px rgba(30,27,46,.5)' }}
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && input.trim()) { e.preventDefault(); void send(input.trim()); } }}
                  placeholder="Ask anything about your content…"
                  style={{ flex: '1 1 auto', border: 'none', outline: 'none', fontSize: '14px', color: '#1E1B2E', background: 'transparent', fontFamily: 'inherit' }}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!input.trim() || busy}
                  onClick={() => { if (input.trim()) void send(input.trim()); }}
                  style={{ width: '32px', height: '32px', borderRadius: '10px', background: '#7C3AED', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', opacity: (!input.trim() || busy) ? 0.4 : 1 }}
                >
                  <Send style={{ width: '16px', height: '16px' }} />
                </button>
              </div>
            )}

            {/* Task plan */}
            {currentPlan && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: '400px', maxWidth: 'calc(100vw - 3rem)', background: 'rgba(20,17,34,.85)', border: '1px solid rgba(124,58,237,.35)', borderRadius: '16px', padding: '16px', backdropFilter: 'blur(12px)', boxShadow: '0 20px 50px -20px rgba(0,0,0,.5)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <BrainCircuit style={{ width: 16, height: 16, color: '#A78BFA' }} />
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#A78BFA' }}>TASK PLAN</span>
                  <span style={{ flex: '1 1 auto' }} />
                  <button type="button" onClick={() => setCurrentPlan(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', padding: 0 }}>
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#fff', marginBottom: '12px' }}>{currentPlan.goal}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {currentPlan.steps.map((step, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <StepIcon status={step.status} />
                      {i < currentPlan.steps.length - 1 && (
                        <ChevronRight style={{ width: 10, height: 10, color: 'rgba(255,255,255,.2)', position: 'absolute', display: 'none' }} />
                      )}
                      <div style={{ flex: '1 1 auto' }}>
                        <span style={{ fontSize: '12px', color: step.status === 'pending' ? 'rgba(255,255,255,.5)' : step.status === 'failed' ? '#F87171' : '#fff', fontWeight: step.status === 'running' ? 700 : 500 }}>{step.label}</span>
                        {step.agentName && <span style={{ fontSize: '11px', color: 'rgba(255,255,255,.3)', marginLeft: '6px' }}>{step.agentName}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confirmation card */}
            {pending && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: '360px', maxWidth: 'calc(100vw - 3rem)', borderRadius: '16px', border: '1px solid #fde68a', background: '#fffbeb', padding: '16px', boxShadow: '0 20px 50px -20px rgba(30,27,46,.4)' }}
              >
                <p style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#92400e', fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                  <ShieldCheck style={{ width: '16px', height: '16px' }} /> Confirm: {pending.action.replace(/_/g, ' ')}
                </p>
                <p style={{ fontSize: '12px', color: '#b45309', marginBottom: '12px' }}>
                  {pendingEstimate !== null ? `Estimated: ${pendingEstimate.toLocaleString()} credits` : 'Cost varies — charged at actual usage'}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => void send('', pending)} style={{ padding: '6px 12px', background: '#7C3AED', color: '#fff', borderRadius: '9px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer' }}>Confirm</button>
                  <button onClick={() => { setPending(null); setPendingEstimate(null); }} style={{ padding: '6px 12px', background: '#f3f4f6', color: '#374151', borderRadius: '9px', fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Agent activity panel */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed bottom-6 right-6 z-[51] flex flex-col gap-3.5 animate-pop-in"
            style={{
              top: '84px', width: '340px',
              background: 'rgba(20,17,34,.5)', backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,.14)', borderRadius: '20px',
              padding: '18px 16px',
              boxShadow: '0 30px 70px -30px rgba(0,0,0,.6)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Panel header with tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '0 4px', marginBottom: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ADE80', boxShadow: '0 0 0 4px rgba(74,222,128,.22)', flexShrink: 0 }} />
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Agent activity</div>
              <div style={{ flex: '1 1 auto' }} />
              {/* STT provider badge */}
              {serverStt !== null && (
                <span style={{ fontSize: '10px', fontWeight: 600, color: serverStt ? '#4ADE80' : 'rgba(255,255,255,.4)', background: 'rgba(255,255,255,.08)', padding: '2px 7px', borderRadius: '9px' }}>
                  {serverStt ? 'Server STT' : 'Browser STT'}
                </span>
              )}
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>live</div>
            </div>

            {/* Messages tab */}
            {!showJobs && (
              <div ref={listRef} style={{ flex: '1 1 auto', overflowY: 'auto', maxHeight: '400px', display: 'flex', flexDirection: 'column', gap: '13px', padding: '2px 4px' }}>
                {messages.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.4)', fontWeight: 500, marginTop: '8px' }}>No activity yet. Say something!</div>
                ) : (
                  messages.slice(-8).map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', opacity: m.role === 'user' ? 0.6 : 1 }}>
                      <span style={{ width: '22px', height: '22px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, fontSize: '11px', fontWeight: 700, background: m.role === 'user' ? 'rgba(255,255,255,.2)' : 'rgba(124,58,237,.8)' }}>
                        {m.role === 'user' ? 'U' : <Bot style={{ width: 12, height: 12 }} />}
                      </span>
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.8)', fontWeight: 500, lineHeight: 1.45 }}>
                        {m.content.slice(0, 140)}{m.content.length > 140 ? '…' : ''}
                        {m.fromCache && <span style={{ fontSize: '10px', color: 'rgba(255,255,255,.3)', marginLeft: '6px' }}>cached</span>}
                      </div>
                    </div>
                  ))
                )}
                {busy && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '2px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#A855F7', animation: 'voiceBar .9s ease-in-out infinite' }} />
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>Processing…</span>
                  </div>
                )}
              </div>
            )}

            {/* Jobs tab */}
            {showJobs && (
              <div style={{ flex: '1 1 auto', overflowY: 'auto', maxHeight: '400px', display: 'flex', flexDirection: 'column', gap: '8px', padding: '2px 4px' }}>
                {recentJobs.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.4)', fontWeight: 500, marginTop: '8px' }}>No jobs yet.</div>
                ) : (
                  recentJobs.map((j) => (
                    <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', background: 'rgba(255,255,255,.05)', borderRadius: '10px' }}>
                      <JobBadge status={j.status} />
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.type.replace(/_/g, ' ')}</div>
                        <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,.4)' }}>{j.project.title.slice(0, 28)}</div>
                      </div>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,.35)', textAlign: 'right', flexShrink: 0 }}>
                        {j.status.toLowerCase()}
                        {j.error && <div style={{ color: '#F87171', marginTop: '2px' }}>{j.error.slice(0, 30)}</div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Org billing picker */}
            {orgs.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: '12px' }}>
                <Building2 style={{ width: '14px', height: '14px', color: 'rgba(255,255,255,.5)', flexShrink: 0 }} />
                <select
                  value={billingOrgId}
                  onChange={(e) => setBillingOrgId(e.target.value)}
                  style={{ flex: '1 1 auto', fontSize: '11px', color: 'rgba(255,255,255,.7)', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: '6px', padding: '4px 8px' }}
                >
                  <option value="">Personal wallet</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
