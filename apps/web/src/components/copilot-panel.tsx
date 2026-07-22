'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot, X, Send, Mic, MicOff, ShieldCheck, Building2,
  CheckCircle2, Circle, Loader2, AlertCircle, BrainCircuit, Zap,
  BookOpen, FileText, Calendar, Search, Clock, Sparkles,
} from 'lucide-react';
import { apiClient, api, type Org } from '@/lib/api';
import { checkInputSafety, httpErrorMessage, SAFETY_COLORS } from '@/lib/safety';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  project: { id: string; title: string };
}

interface QuickAction {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  placeholder: string;
  template: (v: string) => string;
  color: string;
  bg: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'research', icon: BookOpen,  label: 'Research',       description: "I'll dig into any topic for you",                placeholder: 'What topic?',                   template: v => `Research this topic in depth for a YouTube video: ${v}`,                                   color: '#3b82f6', bg: '#eff6ff' },
  { id: 'script',   icon: FileText,  label: 'Script Ideas',   description: 'Build a full script from scratch',               placeholder: 'Video title or concept?',       template: v => `Generate a detailed script outline for a YouTube video titled: "${v}"`,               color: '#7C3AED', bg: '#f5f2fd' },
  { id: 'calendar', icon: Calendar,  label: 'Content Plan',   description: 'Lock in your posting schedule',                  placeholder: "What's your niche?",            template: v => `Suggest a 2-week content calendar for a YouTube channel about: ${v}`,               color: '#10b981', bg: '#ecfdf5' },
  { id: 'seo',      icon: Search,    label: 'SEO Analysis',   description: 'Boost your reach with smarter SEO',              placeholder: 'Topic or keyword?',             template: v => `Analyze the SEO potential and suggest optimized titles, tags, and keywords for: ${v}`, color: '#d97706', bg: '#fefce8' },
  { id: 'ideas',    icon: Sparkles,  label: 'Video Ideas',    description: "Brainstorm ideas that'll actually get views",     placeholder: "What's your channel niche?",    template: v => `Give me 10 viral YouTube video ideas for a channel focused on: ${v}`,               color: '#ec4899', bg: '#fdf2f8' },
  { id: 'factcheck',icon: ShieldCheck, label: 'Fact Check',  description: "Don't get caught slipping — I'll check it",      placeholder: 'Claim to verify?',              template: v => `Fact-check this claim for my YouTube video: "${v}"`,                                color: '#0d9488', bg: '#f0fdfa' },
];

const PROMPT_CHIPS = [
  "What's blowing up in my niche right now?",
  "Give me 5 video ideas I can shoot next week",
  "Help me plan my next 2 weeks of uploads",
  "Check my scripts before I post",
];

const HISTORY_KEY = 'cf_copilot_history';
const MAX_HISTORY = 12;

function loadHistory(): { text: string; ts: number }[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as { text: string; ts: number }[]; }
  catch { return []; }
}

function saveToHistory(text: string) {
  const existing = loadHistory().filter(h => h.text !== text);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([{ text, ts: Date.now() }, ...existing].slice(0, MAX_HISTORY)));
}

function removeFromHistory(text: string) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory().filter(h => h.text !== text)));
}

function relTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5)     return 'just now';
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── STT ────────────────────────────────────────────────────────────────────────

type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { [i: number]: { isFinal: boolean } & ArrayLike<{ transcript: string }> } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void; stop: () => void;
};

function getBrowserRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// ── Voice bar animation ────────────────────────────────────────────────────────

const BAR_HEIGHTS = ['16px','26px','38px','48px','54px','48px','38px','26px','16px'];
const BAR_DELAYS  = ['0s','.09s','.18s','.06s','.15s','.03s','.21s','.12s','.09s'];

function VoiceBars({ active, color = '#fff', compact = false }: { active: boolean; color?: string; compact?: boolean }) {
  const heights = compact
    ? ['5px','9px','13px','17px','19px','17px','13px','9px','5px']
    : BAR_HEIGHTS;
  const w = compact ? '2.5px' : '4px';
  const gap = compact ? '2px' : '3.5px';
  const containerH = compact ? '22px' : '60px';
  return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap,height:containerH }}>
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            display:'inline-block', width:w, borderRadius:'4px',
            background: color,
            height: h,
            transformOrigin: 'center',
            transform: active ? 'scaleY(1)' : 'scaleY(0.12)',
            opacity: active ? 1 : 0.25,
            animation: active ? `cfVoiceBar .75s ease-in-out ${BAR_DELAYS[i]} infinite` : 'none',
            transition: 'transform .4s cubic-bezier(.4,0,.2,1), opacity .4s',
          }}
        />
      ))}
    </div>
  );
}

function StepIcon({ status }: { status: PlanStep['status'] }) {
  if (status === 'done')    return <CheckCircle2 style={{ width:14,height:14,color:'#4ADE80',flexShrink:0 }} />;
  if (status === 'running') return <Loader2 style={{ width:14,height:14,color:'#A78BFA',flexShrink:0,animation:'spin 1s linear infinite' }} />;
  if (status === 'failed')  return <AlertCircle style={{ width:14,height:14,color:'#F87171',flexShrink:0 }} />;
  return <Circle style={{ width:14,height:14,color:'rgba(0,0,0,.2)',flexShrink:0 }} />;
}

function JobDot({ status }: { status: string }) {
  const c: Record<string,string> = { COMPLETED:'#4ADE80',RUNNING:'#A78BFA',PENDING:'#FBBF24',QUEUED:'#FBBF24',FAILED:'#F87171',CANCELLED:'#d1d5db' };
  return <span style={{ display:'inline-block',width:7,height:7,borderRadius:'50%',background:c[status]??'#d1d5db',flexShrink:0 }} />;
}

// ── TTS helpers ────────────────────────────────────────────────────────────────

/**
 * Strip markdown and symbols before handing text to the browser TTS engine.
 * Unprocessed markdown causes "asterisk asterisk", "hashtag", "backtick" etc.
 */
function cleanForTTS(raw: string): string {
  return raw
    // Fenced code blocks → brief label so the user knows it was there
    .replace(/```[\s\S]*?```/g, 'code example.')
    // Inline code → bare content
    .replace(/`([^`\n]+)`/g, '$1')
    // Markdown headings
    .replace(/^#{1,6}\s+/gm, '')
    // Bold / italic (**, __, *, _)
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
    .replace(/_{1,2}([^_\n]+)_{1,2}/g, '$1')
    // Markdown links → just the label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Bare URLs
    .replace(/https?:\/\/\S+/g, '')
    // Blockquotes
    .replace(/^>\s*/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // List markers (bullets and numbered)
    .replace(/^[\s]*[•·▪▸◦\-\*]\s+/gm, '')
    .replace(/^(\s*\d+)[.)]\s+/gm, '$1, ')
    // Decorative arrows / symbols that have no spoken form
    .replace(/[→←↑↓↗↘•·▪▸◦–—]/g, ' ')
    // Paragraph breaks → natural pause
    .replace(/\n{2,}/g, '. ')
    // Remaining line breaks
    .replace(/\n/g, ' ')
    // Collapse whitespace
    .replace(/\s{2,}/g, ' ')
    // Remove stray punctuation clusters left by stripping
    .replace(/([.!?,])\s*([.!?,])+/g, '$1')
    .trim();
}

/**
 * Score voices so we pick the most natural-sounding one available.
 * Higher score = preferred.
 */
function pickBestVoice(voices: SpeechSynthesisVoice[], langTag: string): SpeechSynthesisVoice | null {
  const prefix = langTag.split('-')[0]!.toLowerCase();
  const candidates = voices.filter(v => {
    const vl = v.lang.toLowerCase();
    return vl === langTag.toLowerCase() || vl.startsWith(prefix + '-') || vl === prefix;
  });
  if (!candidates.length) {
    // Fallback: any English voice
    const enFallback = voices.filter(v => v.lang.toLowerCase().startsWith('en'));
    if (enFallback.length) return pickBestVoice(enFallback, 'en-US') ?? enFallback[0] ?? null;
    return null;
  }

  // Keywords that indicate higher-quality synthesis (order = priority)
  const PREFER = ['natural', 'neural', 'enhanced', 'premium', 'online', 'aria', 'jenny', 'guy',
                  'samantha', 'alex', 'zira', 'google us english', 'google uk english'];
  const AVOID  = ['compact', 'linear'];

  const scored = candidates.map(v => {
    const name = v.name.toLowerCase();
    let score = 0;
    if (AVOID.some(a => name.includes(a)))  score -= 20;
    PREFER.forEach((p, i) => { if (name.includes(p)) score += (PREFER.length - i) * 2; });
    if (v.localService) score += 3;  // local voices are more reliable than remote
    if (v.default)      score += 1;
    return { v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.v ?? null;
}

/**
 * Split cleaned text into sentence-sized chunks.
 * Prevents the iOS 200-char TTS bug and Chrome's ~15 s pause on long utterances.
 */
function chunkForTTS(text: string, maxChars = 160): string[] {
  // Split at natural sentence boundaries
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current.length + part.length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = part;
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CopilotPanel() {
  const router = useRouter();

  // open state
  const [open, setOpen]         = useState(false);
  const [activeTab, setActiveTab] = useState<'chat'|'actions'|'jobs'>('chat');

  // chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [pending, setPending]   = useState<CopilotResponse['needsConfirmation']|null>(null);
  const [pendingEst, setPendingEst] = useState<number|null>(null);

  // voice
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking]   = useState(false);
  const [speakReplies]            = useState(true);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [micError, setMicError]   = useState<string|null>(null);
  const [serverStt, setServerStt] = useState<boolean|null>(null);
  const [lang, setLang]           = useState<string>(() => typeof navigator !== 'undefined' ? navigator.language : 'en-US');

  // quick actions
  const [activeAction, setActiveAction] = useState<string|null>(null);
  const [actionInput, setActionInput]   = useState('');

  // jobs + orgs
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [orgs, setOrgs]             = useState<Org[]>([]);
  const [billingOrgId, setBillingOrgId] = useState('');

  // history
  const [history, setHistory] = useState<{ text:string; ts:number }[]>([]);

  function handleDeleteHistory(text: string) {
    removeFromHistory(text);
    setHistory(loadHistory());
  }

  function handleClearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }

  // misc
  const [currentPlan, setCurrentPlan] = useState<TaskPlan|null>(null);
  const conversationRef   = useRef(false);
  const recognitionRef    = useRef<SpeechRecognitionLike|null>(null);
  const mediaRecorderRef  = useRef<MediaRecorder|null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => { setOpen(true); setActiveTab('chat'); };
    window.addEventListener('cf:open-copilot', handler as EventListener);
    return () => window.removeEventListener('cf:open-copilot', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!open) return;
    setHistory(loadHistory());
    api.orgs.mine().then(r => setOrgs(r.data)).catch(() => setOrgs([]));
    apiClient.get('/copilot/stt-status')
      .then(r => setServerStt((r.data as { available: boolean }).available))
      .catch(() => setServerStt(false));
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, pending, currentPlan]);

  useEffect(() => {
    if (!open || activeTab !== 'jobs') return;
    const fetch = () => {
      apiClient.get('/copilot/jobs?take=10')
        .then(r => setRecentJobs((r.data as { data: RecentJob[] }).data))
        .catch(() => undefined);
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, [open, activeTab]);

  useEffect(() => {
    if (!micError) return;
    const id = setTimeout(() => setMicError(null), 6000);
    return () => clearTimeout(id);
  }, [micError]);

  // ── TTS ────────────────────────────────────────────────────────────────────

  const startListeningRef = useRef<() => void>(() => undefined);

  const speak = useCallback((text: string, replyLang?: string, onDone?: () => void) => {
    if (!speakReplies || typeof window === 'undefined' || !window.speechSynthesis) { onDone?.(); return; }

    // Always default to en-US; only switch if API is confident AND a good voice exists
    const target = replyLang ?? lang;
    window.speechSynthesis.cancel();

    const cleaned = cleanForTTS(text);
    if (!cleaned) { onDone?.(); return; }

    const chunks = chunkForTTS(cleaned);
    let chunkIdx = 0;
    // Chrome bug: TTS pauses silently after ~15 s — keep-alive interval resumes it
    let keepAlive: ReturnType<typeof setInterval> | null = null;

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const bestVoice = pickBestVoice(voices, target);

      function next() {
        if (chunkIdx >= chunks.length) {
          if (keepAlive) clearInterval(keepAlive);
          setSpeaking(false);
          onDone?.();
          return;
        }
        const chunk = chunks[chunkIdx++]!;
        const utt = new SpeechSynthesisUtterance(chunk);
        utt.lang   = bestVoice?.lang ?? target;
        utt.rate   = 0.93;   // slightly slower than 1.0 — more natural for AI replies
        utt.pitch  = 1.0;
        utt.volume = 1.0;
        if (bestVoice) utt.voice = bestVoice;
        if (chunkIdx === 1) utt.onstart = () => setSpeaking(true);
        utt.onend   = next;
        utt.onerror = () => { if (keepAlive) clearInterval(keepAlive); setSpeaking(false); onDone?.(); };
        window.speechSynthesis.speak(utt);
      }

      // Chrome keep-alive: resume if paused mid-utterance
      keepAlive = setInterval(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 10_000);

      next();
    };

    // Voices may not be loaded yet on first call (Chrome async)
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
    }
  }, [speakReplies, lang]);

  // ── Send ───────────────────────────────────────────────────────────────────

  const send = useCallback(async (text: string, confirmedCommand?: Record<string, unknown>) => {
    const nextMessages: ChatMessage[] = text
      ? [...messages, { role: 'user' as const, content: text }]
      : messages;
    if (text) {
      setMessages(nextMessages);
      saveToHistory(text);
      setHistory(loadHistory());
    }
    setInput('');
    setLiveTranscript('');
    setPending(null);
    setPendingEst(null);

    // Safety guardrails
    if (text.trim()) {
      const safety = checkInputSafety(text.trim());
      if (!safety.ok) {
        const cat = safety.category ?? 'abuse';
        const colors = SAFETY_COLORS[cat];
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `${colors.icon} ${safety.message}`,
          fromCache: false,
        }]);
        return;
      }
    }

    setBusy(true);
    setActiveTab('chat');
    try {
      const res = await apiClient.post('/copilot/chat', {
        messages: nextMessages.slice(-10),
        inputMode: conversationRef.current ? 'voice' : 'text',
        ...(confirmedCommand ? { confirmedCommand } : {}),
        ...(!confirmedCommand && pending ? { pendingCommand: pending } : {}),
        ...(billingOrgId ? { orgId: billingOrgId } : {}),
      });
      const data = res.data as CopilotResponse;
      setMessages(m => [...m, { role: 'assistant', content: data.reply, fromCache: data.fromCache }]);
      if (data.needsConfirmation) { setPending(data.needsConfirmation); setPendingEst(data.estimatedCredits ?? null); }
      if (data.language) setLang(data.language);
      if (data.plan)     setCurrentPlan(data.plan);
      if (data.navigate) router.push(data.navigate);
      speak(data.reply, data.language, () => { if (conversationRef.current) startListeningRef.current(); });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = status ? httpErrorMessage(status) : 'Something went wrong. Try again.';
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${msg}`, fromCache: false }]);
    } finally {
      setBusy(false);
    }
  }, [messages, speak, pending, billingOrgId, router]);

  // ── STT ────────────────────────────────────────────────────────────────────

  const stopServerSTT = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  const startServerSTT = useCallback(async () => {
    if (typeof window === 'undefined') return;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setListening(false); setMicError('Microphone permission denied'); return; }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];
    setRecording(true);
    recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      setRecording(false); setListening(false);
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      if (blob.size < 500) { setLiveTranscript(''); return; }
      setLiveTranscript('Transcribing…');
      try {
        const form = new FormData();
        form.append('audio', blob, `recording.${mimeType.includes('ogg') ? 'ogg' : 'webm'}`);
        form.append('language', lang.split('-')[0]!);
        const { data } = await apiClient.post('/copilot/transcribe', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        const text = (data as { text: string }).text?.trim() ?? '';
        if (text) { conversationRef.current = true; setLiveTranscript(text); void send(text); }
        else      { setLiveTranscript(''); conversationRef.current = false; }
      } catch { setLiveTranscript('Transcription failed — try again'); conversationRef.current = false; }
    };
    recorder.start(250);
    window.speechSynthesis?.cancel();
  }, [lang, send]);

  const startBrowserSTT = useCallback(async () => {
    const rec = getBrowserRecognition();
    if (!rec) { setListening(false); setMicError('Voice not supported — use Chrome or Edge'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (err) {
      setListening(false); conversationRef.current = false;
      const name = (err as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setMicError('Mic blocked — allow microphone in your browser settings');
      else if (name === 'NotFoundError') setMicError('No microphone found');
      else setMicError('Could not access microphone');
      return;
    }
    recognitionRef.current = rec;
    rec.lang = lang; rec.interimResults = true; rec.continuous = false;
    let finalText = '';
    rec.onresult = e => {
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
      if (finalText.trim()) { conversationRef.current = true; void send(finalText.trim()); }
      else { conversationRef.current = false; setInput(''); setLiveTranscript(''); }
    };
    rec.onerror = e => {
      setListening(false); conversationRef.current = false;
      if (e.error === 'not-allowed') setMicError('Mic blocked — allow microphone in your browser');
    };
    window.speechSynthesis?.cancel();
    try { rec.start(); }
    catch { setListening(false); conversationRef.current = false; setMicError('Could not start microphone'); }
  }, [send, lang]);

  const startListening = useCallback(() => {
    setMicError(null);
    if (serverStt === true) void startServerSTT();
    else void startBrowserSTT();
  }, [serverStt, startServerSTT, startBrowserSTT]);
  startListeningRef.current = startListening;

  const toggleMic = useCallback(() => {
    if (listening || recording) {
      conversationRef.current = false;
      if (mediaRecorderRef.current) stopServerSTT();
      else recognitionRef.current?.stop();
      setListening(false); setRecording(false);
      return;
    }
    setListening(true); setMicError(null); conversationRef.current = true;
    startListening();
  }, [listening, recording, startListening, stopServerSTT]);

  const close = useCallback(() => {
    conversationRef.current = false;
    if (mediaRecorderRef.current) stopServerSTT();
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
    setOpen(false);
  }, [stopServerSTT]);

  // ── Input handlers ─────────────────────────────────────────────────────────

  function handleTextarea(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) void send(input.trim()); }
  }

  const statusLabel = micError ? micError : listening ? 'Listening…' : speaking ? 'Speaking…' : busy ? 'Thinking…' : 'Ready';
  const statusColor = micError ? '#F87171' : listening ? '#4ADE80' : speaking ? '#A78BFA' : busy ? '#FBBF24' : '#4ADE80';

  const currentAction = QUICK_ACTIONS.find(a => a.id === activeAction);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isVoiceActive = listening || recording;
  const isTranscribing = liveTranscript === 'Transcribing…';

  return (
    <>
      <style>{`
        @keyframes cfVoiceBar {
          0%,100% { transform: scaleY(0.25); opacity:0.5; }
          50%      { transform: scaleY(1);    opacity:1;   }
        }
        @keyframes cfRipple {
          0%   { transform: scale(1);   opacity: 0.65; }
          100% { transform: scale(1.9); opacity: 0;    }
        }
        @keyframes cfPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.5; }
        }
        /* box-shadow ripple — never clipped by overflow-y:auto scroll containers */
        @keyframes cfMicGlow {
          0%,100% {
            box-shadow: 0 0 0 0px rgba(255,255,255,.55),
                        0 0 0 0px rgba(255,255,255,.25),
                        0 8px 28px rgba(0,0,0,.22);
          }
          50% {
            box-shadow: 0 0 0 12px rgba(255,255,255,.10),
                        0 0 0 24px rgba(255,255,255,.04),
                        0 8px 28px rgba(0,0,0,.22);
          }
        }
      `}</style>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position:'fixed', inset:0, zIndex:45,
          background: open ? 'rgba(30,27,46,.22)' : 'transparent',
          backdropFilter: open ? 'blur(2px)' : 'none',
          pointerEvents: open ? 'auto' : 'none',
          transition:'background 250ms ease, backdrop-filter 250ms ease',
        }}
      />

      {/* Drawer */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position:'fixed', top:0, right:0, bottom:0,
          width:'460px', zIndex:46,
          background:'#faf9ff',
          borderLeft:'1px solid #E2DCF5',
          boxShadow:'-24px 0 60px -20px rgba(30,27,46,.18)',
          display:'flex', flexDirection:'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition:'transform 300ms cubic-bezier(.4,0,.2,1)',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding:'0 18px',
          height:'64px',
          display:'flex', alignItems:'center', gap:'12px',
          background:'linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%)',
          flexShrink:0,
        }}>
          <div style={{ width:'38px',height:'38px',borderRadius:'11px',background:'rgba(255,255,255,.15)',border:'1px solid rgba(255,255,255,.2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            <Bot style={{ width:'20px',height:'20px',color:'#fff' }} />
          </div>
          <div style={{ flex:'1 1 auto', minWidth:0 }}>
            <div style={{ fontSize:'15px',fontWeight:700,color:'#fff',letterSpacing:'-.2px' }}>Copilot</div>
            <div style={{ display:'flex',alignItems:'center',gap:'5px',marginTop:'1px' }}>
              <span style={{ width:'6px',height:'6px',borderRadius:'50%',background:statusColor,flexShrink:0,transition:'background .3s',boxShadow:`0 0 0 3px ${statusColor}30` }} />
              <span style={{ fontSize:'11.5px',color:'rgba(255,255,255,.68)',fontWeight:500 }}>{statusLabel}</span>
              {serverStt !== null && (
                <span style={{ marginLeft:'4px',fontSize:'10px',fontWeight:600,color:'rgba(255,255,255,.4)',background:'rgba(255,255,255,.1)',padding:'1px 6px',borderRadius:'9px' }}>
                  {serverStt ? 'Server STT' : 'Browser STT'}
                </span>
              )}
            </div>
          </div>
          {/* Mic */}
          <div style={{ position:'relative',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center' }}>
            {isVoiceActive && (
              <>
                <div style={{ position:'absolute',width:'48px',height:'48px',borderRadius:'50%',border:'2px solid rgba(74,222,128,.5)',animation:'cfRipple 1.4s ease-out infinite',pointerEvents:'none' }} />
                <div style={{ position:'absolute',width:'48px',height:'48px',borderRadius:'50%',border:'2px solid rgba(74,222,128,.3)',animation:'cfRipple 1.4s ease-out .7s infinite',pointerEvents:'none' }} />
              </>
            )}
            <button
              type="button"
              title={isVoiceActive ? 'Stop recording' : 'Voice input'}
              onClick={toggleMic}
              style={{
                width:'36px',height:'36px',borderRadius:'10px',zIndex:1,
                background: isVoiceActive ? 'rgba(74,222,128,.25)' : 'rgba(255,255,255,.12)',
                border: `1.5px solid ${isVoiceActive ? 'rgba(74,222,128,.6)' : 'rgba(255,255,255,.18)'}`,
                color: isVoiceActive ? '#4ADE80' : 'rgba(255,255,255,.82)',
                display:'flex',alignItems:'center',justifyContent:'center',
                cursor:'pointer',transition:'background .2s,border-color .2s',
              }}
            >
              {isVoiceActive ? <MicOff style={{ width:'16px',height:'16px' }} /> : <Mic style={{ width:'16px',height:'16px' }} />}
            </button>
          </div>
          {/* Close */}
          <button
            type="button"
            title="Close Copilot"
            onClick={close}
            style={{
              width:'36px',height:'36px',borderRadius:'10px',flexShrink:0,
              background:'rgba(255,255,255,.12)',border:'1px solid rgba(255,255,255,.18)',
              color:'rgba(255,255,255,.82)',display:'flex',alignItems:'center',justifyContent:'center',
              cursor:'pointer',transition:'background .2s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,.22)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,.12)'; }}
          >
            <X style={{ width:'18px',height:'18px' }} />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display:'flex',borderBottom:'1px solid #EDE9F8',background:'#fff',flexShrink:0,padding:'0 4px' }}>
          {(['chat','actions','jobs'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding:'13px 16px',
                fontSize:'13px',
                fontWeight: activeTab===tab ? 600 : 500,
                color: activeTab===tab ? '#7C3AED' : '#8b88a0',
                borderBottom: `2px solid ${activeTab===tab ? '#7C3AED' : 'transparent'}`,
                background:'none',border:'none',
                borderBottomWidth:'2px',
                borderBottomStyle:'solid',
                borderBottomColor: activeTab===tab ? '#7C3AED' : 'transparent',
                cursor:'pointer',
                transition:'color 150ms, border-color 150ms',
                letterSpacing:'-.05px',
              }}
            >
              {tab === 'chat' ? 'Chat' : tab === 'actions' ? 'Quick Actions' : 'Tasks'}
            </button>
          ))}
        </div>

        {/* ── Chat tab ── */}
        {activeTab === 'chat' && (
          <>
            {/* Messages */}
            <div style={{ flex:'1 1 auto', overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:'14px' }}>
              {messages.length === 0 && !busy && (
                <div style={{ textAlign:'center', paddingTop:'32px' }}>
                  <div style={{ width:'52px',height:'52px',borderRadius:'16px',background:'linear-gradient(135deg,#7C3AED,#5B21B6)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',boxShadow:'0 8px 20px -8px rgba(124,58,237,.5)' }}>
                    <Bot style={{ width:'26px',height:'26px',color:'#fff' }} />
                  </div>
                  <div style={{ fontSize:'16px',fontWeight:700,color:'#1E1B2E',marginBottom:'6px' }}>What's on your mind?</div>
                  <div style={{ fontSize:'13px',color:'#8b88a0',marginBottom:'24px',lineHeight:1.5 }}>Scripts, SEO, ideas, research — just say the word.</div>
                  <div style={{ display:'flex',flexWrap:'wrap',gap:'8px',justifyContent:'center' }}>
                    {PROMPT_CHIPS.map(chip => (
                      <button
                        key={chip}
                        onClick={() => void send(chip)}
                        style={{
                          padding:'8px 14px',borderRadius:'99px',fontSize:'12.5px',fontWeight:500,
                          background:'#fff',border:'1px solid #E2DCF5',color:'#4d4a6b',
                          cursor:'pointer',transition:'background .15s,border-color .15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#F5F2FD'; (e.currentTarget as HTMLElement).style.borderColor='#C4B5FD'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='#fff'; (e.currentTarget as HTMLElement).style.borderColor='#E2DCF5'; }}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} style={{ display:'flex', gap:'10px', flexDirection: m.role==='user' ? 'row-reverse' : 'row', alignItems:'flex-end' }}>
                  <div style={{
                    width:'30px',height:'30px',borderRadius:'9px',flexShrink:0,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    background: m.role==='user' ? '#1E1B2E' : 'linear-gradient(135deg,#7C3AED,#5B21B6)',
                    color:'#fff',fontSize:'11px',fontWeight:700,
                  }}>
                    {m.role==='user' ? 'U' : <Zap style={{ width:'14px',height:'14px' }} />}
                  </div>
                  <div style={{ maxWidth:'78%', display:'flex', flexDirection:'column', gap:'4px', alignItems: m.role==='user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      padding:'11px 14px',
                      borderRadius: m.role==='user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      fontSize:'13.5px',lineHeight:1.55,whiteSpace:'pre-wrap',
                      background: m.role==='user' ? 'linear-gradient(135deg,#7C3AED,#5B21B6)' : '#fff',
                      color: m.role==='user' ? '#fff' : '#1E1B2E',
                      boxShadow: m.role==='user' ? '0 4px 14px -6px rgba(124,58,237,.45)' : '0 1px 6px rgba(30,27,46,.07)',
                      border: m.role==='assistant' ? '1px solid #EDE9F8' : 'none',
                    }}>
                      {m.content}
                      {m.fromCache && <span style={{ fontSize:'10px',color:'rgba(255,255,255,.45)',marginLeft:'6px' }}>cached</span>}
                    </div>
                  </div>
                </div>
              ))}

              {busy && (
                <div style={{ display:'flex',gap:'10px',alignItems:'flex-end' }}>
                  <div style={{ width:'30px',height:'30px',borderRadius:'9px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(135deg,#7C3AED,#5B21B6)' }}>
                    <Zap style={{ width:'14px',height:'14px',color:'#fff' }} />
                  </div>
                  <div style={{ padding:'10px 16px 8px',borderRadius:'16px 16px 16px 4px',background:'linear-gradient(160deg,#7C3AED 0%,#5B21B6 100%)',border:'1px solid rgba(124,58,237,.2)',boxShadow:'0 4px 16px -4px rgba(124,58,237,.3)' }}>
                    <VoiceBars active compact color="rgba(233,213,255,.85)" />
                    <div style={{ fontSize:'10.5px',fontWeight:600,color:'rgba(233,213,255,.55)',textAlign:'center',marginTop:'2px',letterSpacing:'.3px' }}>Hmm…</div>
                  </div>
                </div>
              )}

              {/* Task plan */}
              {currentPlan && (
                <div style={{ background:'#1E1B2E',borderRadius:'14px',padding:'14px 16px',border:'1px solid rgba(124,58,237,.3)' }}>
                  <div style={{ display:'flex',alignItems:'center',gap:'7px',marginBottom:'10px' }}>
                    <BrainCircuit style={{ width:14,height:14,color:'#A78BFA' }} />
                    <span style={{ fontSize:'11px',fontWeight:700,color:'#A78BFA',letterSpacing:'.5px' }}>TASK PLAN</span>
                    <div style={{ flex:'1 1 auto' }} />
                    <button type="button" onClick={() => setCurrentPlan(null)} style={{ background:'none',border:'none',color:'rgba(255,255,255,.35)',cursor:'pointer',padding:0 }}><X style={{ width:12,height:12 }} /></button>
                  </div>
                  <p style={{ fontSize:'13px',fontWeight:600,color:'#fff',marginBottom:'10px' }}>{currentPlan.goal}</p>
                  <div style={{ display:'flex',flexDirection:'column',gap:'7px' }}>
                    {currentPlan.steps.map((step, i) => (
                      <div key={i} style={{ display:'flex',alignItems:'center',gap:'8px' }}>
                        <StepIcon status={step.status} />
                        <span style={{ fontSize:'12px',color:step.status==='pending'?'rgba(255,255,255,.45)':step.status==='failed'?'#F87171':'#fff',fontWeight:step.status==='running'?700:500 }}>{step.label}</span>
                        {step.agentName && <span style={{ fontSize:'11px',color:'rgba(255,255,255,.3)',marginLeft:'4px' }}>{step.agentName}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Confirm action */}
              {pending && (
                <div style={{ background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'14px',padding:'14px 16px' }}>
                  <div style={{ display:'flex',alignItems:'center',gap:'6px',color:'#92400e',fontWeight:600,fontSize:'13px',marginBottom:'4px' }}>
                    <ShieldCheck style={{ width:'15px',height:'15px' }} />
                    Confirm: {pending.action.replace(/_/g,' ')}
                  </div>
                  <p style={{ fontSize:'12px',color:'#b45309',marginBottom:'12px' }}>
                    {pendingEst !== null ? `Estimated: ${pendingEst.toLocaleString()} credits` : 'Cost varies — charged at actual usage'}
                  </p>
                  <div style={{ display:'flex',gap:'8px' }}>
                    <button onClick={() => void send('', pending)} style={{ padding:'7px 14px',background:'#7C3AED',color:'#fff',borderRadius:'9px',fontSize:'12.5px',fontWeight:600,border:'none',cursor:'pointer' }}>Confirm</button>
                    <button onClick={() => { setPending(null); setPendingEst(null); }} style={{ padding:'7px 14px',background:'#f3f4f6',color:'#374151',borderRadius:'9px',fontSize:'12.5px',fontWeight:600,border:'none',cursor:'pointer' }}>Cancel</button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div style={{ padding:'12px 16px 16px',background:'#fff',borderTop:'1px solid #EDE9F8',flexShrink:0 }}>
              {isVoiceActive ? (
                /* Voice-active input bar */
                <div style={{ display:'flex',alignItems:'center',gap:'10px',background:'linear-gradient(135deg,#7C3AED,#5B21B6)',borderRadius:'16px',padding:'10px 12px 10px 16px' }}>
                  {/* Mini waveform */}
                  <div style={{ display:'flex',alignItems:'center',gap:'2.5px',flexShrink:0 }}>
                    {['10px','18px','24px','18px','10px'].map((h, i) => (
                      <span key={i} style={{ display:'inline-block',width:'3px',borderRadius:'3px',background:'rgba(255,255,255,.9)',height:h,animation:`cfVoiceBar .65s ease-in-out ${[0,.1,.2,.1,0][i]}s infinite`,opacity:.9 }} />
                    ))}
                  </div>
                  <span style={{ flex:'1 1 auto',fontSize:'13.5px',fontWeight:500,color:'rgba(255,255,255,.85)' }}>Listening… go ahead</span>
                  <button
                    type="button"
                    onClick={toggleMic}
                    style={{ display:'flex',alignItems:'center',gap:'6px',padding:'7px 14px',borderRadius:'10px',background:'rgba(255,255,255,.18)',border:'1px solid rgba(255,255,255,.3)',color:'#fff',fontSize:'12.5px',fontWeight:600,cursor:'pointer',flexShrink:0 }}
                  >
                    <span style={{ width:'8px',height:'8px',borderRadius:'2px',background:'#fff',flexShrink:0 }} />
                    Stop
                  </button>
                </div>
              ) : isTranscribing ? (
                /* Transcribing state */
                <div style={{ display:'flex',alignItems:'center',gap:'10px',background:'#F5F2FD',border:'1.5px solid #DDD6FE',borderRadius:'16px',padding:'12px 16px' }}>
                  <Loader2 style={{ width:'18px',height:'18px',color:'#7C3AED',animation:'spin 1s linear infinite',flexShrink:0 }} />
                  <span style={{ fontSize:'13.5px',fontWeight:500,color:'#6D28D9' }}>Got it, processing…</span>
                </div>
              ) : (busy || speaking) ? (
                /* AI thinking / speaking state */
                <div style={{ display:'flex',alignItems:'center',gap:'10px',background:'#1E1B2E',borderRadius:'16px',padding:'10px 14px 10px 16px' }}>
                  <div style={{ display:'flex',alignItems:'center',gap:'2px',flexShrink:0 }}>
                    {['8px','14px','20px','14px','8px'].map((h, i) => (
                      <span key={i} style={{ display:'inline-block',width:'3px',borderRadius:'3px',background:'rgba(167,139,250,.9)',height:h,animation:`cfVoiceBar .65s ease-in-out ${[0,.1,.2,.1,0][i]}s infinite` }} />
                    ))}
                  </div>
                  <span style={{ flex:'1 1 auto',fontSize:'13.5px',fontWeight:500,color:'rgba(255,255,255,.7)' }}>
                    {speaking ? 'Saying it out loud…' : 'On it…'}
                  </span>
                  <span style={{ fontSize:'13px',color:'rgba(167,139,250,.5)',animation:'cfPulse 1.5s ease-in-out infinite',letterSpacing:'3px' }}>•••</span>
                </div>
              ) : micError ? (
                /* Mic error */
                <div style={{ display:'flex',alignItems:'center',gap:'10px',background:'#FEF2F2',border:'1.5px solid #FECACA',borderRadius:'16px',padding:'12px 16px' }}>
                  <MicOff style={{ width:'16px',height:'16px',color:'#EF4444',flexShrink:0 }} />
                  <span style={{ flex:'1 1 auto',fontSize:'13px',fontWeight:500,color:'#B91C1C' }}>{micError}</span>
                  <button type="button" onClick={() => setMicError(null)} style={{ background:'none',border:'none',color:'#EF4444',cursor:'pointer',padding:0,display:'flex' }}><X style={{ width:'14px',height:'14px' }} /></button>
                </div>
              ) : (
                /* Normal text input */
                <>
                  <div style={{ display:'flex',alignItems:'flex-end',gap:'8px',background:'#F7F6FB',border:'1.5px solid #E2DCF5',borderRadius:'16px',padding:'8px 8px 8px 14px',transition:'border-color .15s' }}
                    onFocusCapture={e => { (e.currentTarget as HTMLElement).style.borderColor='#C4B5FD'; }}
                    onBlurCapture={e => { (e.currentTarget as HTMLElement).style.borderColor='#E2DCF5'; }}
                  >
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleTextarea}
                      onKeyDown={handleKeyDown}
                      disabled={busy}
                      placeholder="What's on your mind?"
                      rows={1}
                      style={{ flex:'1 1 auto',background:'none',border:'none',outline:'none',resize:'none',fontSize:'14px',color:'#1E1B2E',fontFamily:'inherit',maxHeight:'100px',lineHeight:1.5,paddingTop:'2px' }}
                    />
                    <button
                      type="button"
                      onClick={() => { if (input.trim()) void send(input.trim()); }}
                      disabled={!input.trim() || busy}
                      style={{
                        width:'34px',height:'34px',borderRadius:'10px',flexShrink:0,
                        background:'linear-gradient(135deg,#7C3AED,#5B21B6)',color:'#fff',
                        display:'flex',alignItems:'center',justifyContent:'center',
                        border:'none',cursor:'pointer',
                        opacity: (!input.trim() || busy) ? 0.4 : 1,
                        transition:'opacity .15s',
                      }}
                    >
                      <Send style={{ width:'15px',height:'15px' }} />
                    </button>
                  </div>
                  <p style={{ fontSize:'11px',color:'#b8b5c8',textAlign:'center',marginTop:'7px',fontWeight:500 }}>Enter to send  ·  Shift+Enter to break</p>
                </>
              )}
            </div>
          </>
        )}

        {/* ── Quick Actions tab ── */}
        {activeTab === 'actions' && (
          <div style={{ flex:'1 1 auto',overflowY:'auto',padding:'16px' }}>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'20px' }}>
              {QUICK_ACTIONS.map(action => {
                const Icon = action.icon;
                const isActive = activeAction === action.id;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => { setActiveAction(isActive ? null : action.id); setActionInput(''); }}
                    style={{
                      display:'flex',flexDirection:'column',alignItems:'flex-start',gap:'10px',
                      padding:'14px',borderRadius:'14px',textAlign:'left',cursor:'pointer',
                      background: isActive ? action.bg : '#fff',
                      border: `1.5px solid ${isActive ? action.color+'55' : '#EDE9F8'}`,
                      transition:'background .15s,border-color .15s,transform .15s',
                    }}
                    onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background=action.bg; (e.currentTarget as HTMLElement).style.transform='translateY(-1px)'; } }}
                    onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background='#fff'; (e.currentTarget as HTMLElement).style.transform='none'; } }}
                  >
                    <div style={{ width:'32px',height:'32px',borderRadius:'10px',background:action.bg,display:'flex',alignItems:'center',justifyContent:'center',border:`1px solid ${action.color}22` }}>
                      <Icon style={{ width:'16px',height:'16px',color:action.color }} />
                    </div>
                    <div>
                      <div style={{ fontSize:'13px',fontWeight:600,color: isActive ? action.color : '#1E1B2E',marginBottom:'2px' }}>{action.label}</div>
                      <div style={{ fontSize:'11.5px',color:'#8b88a0',lineHeight:1.4 }}>{action.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Expanded action input */}
            {currentAction && (
              <div style={{ background:currentAction.bg,border:`1.5px solid ${currentAction.color}44`,borderRadius:'14px',padding:'14px',marginBottom:'20px' }}>
                <p style={{ fontSize:'12.5px',fontWeight:600,color:currentAction.color,marginBottom:'10px' }}>{currentAction.description}</p>
                <input
                  autoFocus
                  value={actionInput}
                  onChange={e => setActionInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && actionInput.trim()) {
                      void send(currentAction.template(actionInput.trim()));
                      setActiveAction(null);
                      setActionInput('');
                    }
                  }}
                  placeholder={currentAction.placeholder}
                  style={{ width:'100%',padding:'9px 12px',borderRadius:'10px',border:'1px solid #E2DCF5',fontSize:'13.5px',outline:'none',background:'#fff',color:'#1E1B2E',fontFamily:'inherit',boxSizing:'border-box' }}
                />
                <div style={{ display:'flex',gap:'8px',marginTop:'10px' }}>
                  <button
                    type="button"
                    onClick={() => { if (actionInput.trim()) { void send(currentAction.template(actionInput.trim())); setActiveAction(null); setActionInput(''); } }}
                    disabled={!actionInput.trim()}
                    style={{ flex:'1 1 auto',padding:'9px',borderRadius:'10px',fontSize:'13px',fontWeight:600,color:'#fff',background:`linear-gradient(135deg,${currentAction.color},${currentAction.color}cc)`,border:'none',cursor:'pointer',opacity:actionInput.trim()?1:0.4 }}
                  >
                    Ask Copilot →
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveAction(null); setActionInput(''); }}
                    style={{ width:'38px',borderRadius:'10px',background:'#fff',border:'1px solid #E2DCF5',color:'#8b88a0',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' }}
                  >
                    <X style={{ width:'14px',height:'14px' }} />
                  </button>
                </div>
              </div>
            )}

            {/* Recent prompts */}
            <div style={{ marginBottom:'8px' }}>
              <div style={{ display:'flex',alignItems:'center',gap:'6px',fontSize:'11px',fontWeight:700,letterSpacing:'.5px',textTransform:'uppercase',color:'#b8b5c8',marginBottom:'10px' }}>
                <Clock style={{ width:'12px',height:'12px' }} /> Recent
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    style={{ marginLeft:'auto',fontSize:'11px',fontWeight:600,color:'#b8b5c8',background:'none',border:'none',cursor:'pointer',padding:0,letterSpacing:'normal',textTransform:'none',fontFamily:'inherit' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color='#EF4444'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color='#b8b5c8'; }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <p style={{ fontSize:'12.5px',color:'#b8b5c8',textAlign:'center',marginTop:'16px' }}>Your recent prompts will appear here</p>
              ) : (
                <div style={{ display:'flex',flexDirection:'column',gap:'4px' }}>
                  {history.map((h, i) => (
                    <div
                      key={i}
                      style={{ display:'flex',alignItems:'center',gap:'4px',borderRadius:'10px',transition:'background .15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#F5F2FD'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; }}
                    >
                      <button
                        type="button"
                        onClick={() => { setActiveTab('chat'); void send(h.text); }}
                        style={{ flex:'1 1 auto',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',padding:'10px 12px',borderRadius:'10px',background:'transparent',border:'none',cursor:'pointer',textAlign:'left' }}
                      >
                        <span style={{ fontSize:'13px',color:'#1E1B2E',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:'1 1 auto' }}>{h.text}</span>
                        <span style={{ fontSize:'11px',color:'#b8b5c8',fontWeight:500,flexShrink:0 }}>{relTime(h.ts)}</span>
                      </button>
                      <button
                        type="button"
                        title="Remove"
                        onClick={() => handleDeleteHistory(h.text)}
                        style={{ width:'26px',height:'26px',borderRadius:'7px',background:'transparent',border:'none',color:'#c4c0d4',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,marginRight:'4px',transition:'background .15s,color .15s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#FEE2E2'; (e.currentTarget as HTMLElement).style.color='#EF4444'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; (e.currentTarget as HTMLElement).style.color='#c4c0d4'; }}
                      >
                        <X style={{ width:'12px',height:'12px' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Jobs tab ── */}
        {activeTab === 'jobs' && (
          <div style={{ flex:'1 1 auto',overflowY:'auto',padding:'16px',display:'flex',flexDirection:'column',gap:'8px' }}>
            {recentJobs.length === 0 ? (
              <div style={{ textAlign:'center',paddingTop:'32px' }}>
                <Zap style={{ width:'32px',height:'32px',color:'#C4B5FD',margin:'0 auto 12px' }} />
                <p style={{ fontSize:'13.5px',color:'#8b88a0' }}>No tasks yet</p>
              </div>
            ) : (
              recentJobs.map(j => (
                <div key={j.id} style={{ display:'flex',alignItems:'center',gap:'10px',padding:'11px 13px',background:'#fff',border:'1px solid #EDE9F8',borderRadius:'12px',boxShadow:'0 1px 3px rgba(30,27,46,.04)' }}>
                  <JobDot status={j.status} />
                  <div style={{ flex:'1 1 auto',minWidth:0 }}>
                    <div style={{ fontSize:'13px',fontWeight:600,color:'#1E1B2E',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{j.type.replace(/_/g,' ')}</div>
                    <div style={{ fontSize:'11.5px',color:'#8b88a0',marginTop:'1px' }}>{j.project.title.slice(0,36)}</div>
                    {j.error && <div style={{ fontSize:'11px',color:'#F87171',marginTop:'2px' }}>{j.error.slice(0,50)}</div>}
                  </div>
                  <span style={{ fontSize:'11px',fontWeight:600,color:'#8b88a0',flexShrink:0,textTransform:'capitalize' }}>{j.status.toLowerCase()}</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Org picker (footer, always visible) ── */}
        {orgs.length > 0 && (
          <div style={{ padding:'10px 16px',borderTop:'1px solid #EDE9F8',background:'#fff',flexShrink:0,display:'flex',alignItems:'center',gap:'8px' }}>
            <Building2 style={{ width:'14px',height:'14px',color:'#b8b5c8',flexShrink:0 }} />
            <select
              value={billingOrgId}
              onChange={e => setBillingOrgId(e.target.value)}
              style={{ flex:'1 1 auto',fontSize:'12px',color:'#4d4a6b',background:'#F7F6FB',border:'1px solid #E2DCF5',borderRadius:'8px',padding:'5px 8px',outline:'none',fontFamily:'inherit' }}
            >
              <option value="">Personal wallet</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
      </div>
    </>
  );
}
