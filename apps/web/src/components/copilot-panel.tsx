'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, X, Send, Mic, MicOff, Loader2, Volume2, VolumeX, ShieldCheck, Building2 } from 'lucide-react';
import { apiClient, api, type Org } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  fromCache?: boolean;
}

interface CopilotResponse {
  reply: string;
  language?: string;
  executed?: { action: string; result: unknown };
  needsConfirmation?: Record<string, unknown> & { action: string };
  /** Credit quote for the action awaiting confirmation; null = cost varies. */
  estimatedCredits?: number | null;
  fromCache?: boolean;
}

// Browser SpeechRecognition (client-side STT — no provider cost, graceful fallback)
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { [i: number]: { isFinal: boolean } & ArrayLike<{ transcript: string }> } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/**
 * Copilot (master prompt §8): chat + voice control of the pipeline. Commands
 * are decided and validated server-side; expensive actions come back as a
 * confirmation card the user must approve.
 */
export function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CopilotResponse['needsConfirmation'] | null>(null);
  const [pendingEstimate, setPendingEstimate] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  // Voice replies default ON — the copilot answers aloud in the user's language
  const [speakReplies, setSpeakReplies] = useState(true);
  // Two-way conversation: after the bot speaks, the mic reopens for the reply.
  // Armed whenever the user's last turn was voice; disarmed on typing/close.
  const conversationRef = useRef(false);
  // BCP-47 of the user's speaking language, updated from every server reply
  const [lang, setLang] = useState<string>(() =>
    typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const voiceSupported = typeof window !== 'undefined' && !!getRecognition();
  // Phase 5 §10: bill turns (chat + voice) to an org shared wallet; '' = personal
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [billingOrgId, setBillingOrgId] = useState('');

  useEffect(() => {
    if (!open) return;
    api.orgs.mine()
      .then((r) => setOrgs(r.data))
      .catch(() => setOrgs([])); // not signed in / no orgs — picker stays hidden
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, busy]);

  const speak = useCallback((text: string, replyLang?: string, onDone?: () => void) => {
    if (!speakReplies || typeof window === 'undefined' || !window.speechSynthesis) {
      onDone?.();
      return;
    }
    const target = replyLang ?? lang;
    window.speechSynthesis.cancel(); // barge-in: new reply interrupts the old one
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = target;
    // Prefer an installed voice matching the user's language (e.g. hi-IN)
    const voices = window.speechSynthesis.getVoices();
    const prefix = target.split('-')[0]!.toLowerCase();
    const match = voices.find((v) => v.lang.toLowerCase() === target.toLowerCase())
      ?? voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
    if (match) utterance.voice = match;
    utterance.onend = () => onDone?.();
    utterance.onerror = () => onDone?.();
    window.speechSynthesis.speak(utterance);
  }, [speakReplies, lang]);

  // Set after startListening is defined; lets speak()'s onend reopen the mic
  const startListeningRef = useRef<() => void>(() => undefined);

  const send = useCallback(async (text: string, confirmedCommand?: Record<string, unknown>) => {
    const nextMessages: ChatMessage[] = text
      ? [...messages, { role: 'user' as const, content: text }]
      : messages;
    if (text) setMessages(nextMessages);
    setInput('');
    setPending(null);
    setPendingEstimate(null);
    setBusy(true);
    try {
      const res = await apiClient.post('/copilot/chat', {
        messages: nextMessages.slice(-10),
        inputMode: conversationRef.current ? 'voice' : 'text',
        ...(confirmedCommand ? { confirmedCommand } : {}),
        // Lets a spoken "yes" complete the awaiting confirmation
        ...(!confirmedCommand && pending ? { pendingCommand: pending } : {}),
        ...(billingOrgId ? { orgId: billingOrgId } : {}),
      });
      const data = res.data as CopilotResponse;
      setMessages((m) => [...m, { role: 'assistant', content: data.reply, fromCache: data.fromCache }]);
      if (data.needsConfirmation) {
        setPending(data.needsConfirmation);
        setPendingEstimate(data.estimatedCredits ?? null);
      }
      if (data.language) setLang(data.language); // STT + TTS follow the user's language
      // Two-way turn-taking: when the user spoke, the bot speaks back and
      // then reopens the mic for their answer — a real conversation loop.
      speak(data.reply, data.language, () => {
        if (conversationRef.current) startListeningRef.current();
      });
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong: ${e.response?.data?.message ?? 'request failed'}` }]);
    } finally {
      setBusy(false);
    }
  }, [messages, speak, pending, billingOrgId]);

  const startListening = useCallback(() => {
    const rec = getRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    rec.lang = lang; // listen in the language the user has been speaking
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
      setInput(finalText + interim); // live transcript while speaking
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) {
        conversationRef.current = true; // voice turn keeps the conversation loop armed
        void send(finalText.trim());
      } else {
        // Silence — end the hands-free loop rather than listening forever
        conversationRef.current = false;
        setInput('');
      }
    };
    rec.onerror = () => { setListening(false); conversationRef.current = false; };
    window.speechSynthesis?.cancel(); // barge-in
    rec.start();
    setListening(true);
  }, [send, lang]);
  startListeningRef.current = startListening;

  const toggleMic = useCallback(() => {
    if (listening) {
      conversationRef.current = false;
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    conversationRef.current = true;
    startListening();
  }, [listening, startListening]);

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-b from-[#9d6ff0] to-[#7c4fd8] text-white shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
          title="Copilot — type or speak to control the pipeline"
          aria-label="Open Copilot"
        >
          <Bot className="w-7 h-7" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[540px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] text-white flex items-center gap-2">
            <Bot className="w-5 h-5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">Copilot</p>
              <p className="text-[11px] text-white/70">Type or speak — I run the pipeline for you</p>
            </div>
            <button onClick={() => setSpeakReplies((s) => !s)} className="p-1.5 hover:bg-white/10 rounded-lg" title={speakReplies ? 'Voice replies on' : 'Voice replies off'}>
              {speakReplies ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                conversationRef.current = false;
                recognitionRef.current?.stop();
                window.speechSynthesis?.cancel();
                setOpen(false);
              }}
              className="p-1.5 hover:bg-white/10 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Bill-to picker — only shown when the user belongs to an org */}
          {orgs.length > 0 && (
            <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-gray-500" />
              <label htmlFor="copilot-billing-org" className="text-[11px] text-gray-500">Bill to</label>
              <select
                id="copilot-billing-org"
                value={billingOrgId}
                onChange={(e) => setBillingOrgId(e.target.value)}
                className="flex-1 text-[11px] text-gray-700 bg-transparent border border-gray-200 rounded px-1.5 py-0.5"
              >
                <option value="">Personal wallet</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Messages */}
          <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-xs text-gray-500 space-y-2">
                <p className="font-medium text-gray-500">Try:</p>
                <p>“What's the status of my project?”</p>
                <p>“Show my top highlights”</p>
                <p>“Render clip … ” / “Re-run the music stage”</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                  {m.content}
                  {m.fromCache && (
                    <span className="inline-flex items-center gap-0.5 ml-1 text-[10px] text-amber-500" title="Answered from intent cache — zero AI tokens">⚡ instant</span>
                  )}
                </div>
              </div>
            ))}
            {pending && (
              <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 text-sm">
                <p className="flex items-center gap-1.5 text-amber-800 font-medium text-xs mb-1">
                  <ShieldCheck className="w-4 h-4" /> Confirm: {pending.action.replace(/_/g, ' ')}
                </p>
                <p className="text-[11px] text-amber-700 mb-2">
                  {pendingEstimate !== null
                    ? `Estimated cost: ${pendingEstimate.toLocaleString()} credits`
                    : 'Cost depends on usage — charged from your wallet at actual usage'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void send('', pending)}
                    className="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-700"
                  >
                    Yes, do it
                  </button>
                  <button onClick={() => setPending(null)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {busy && (
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> thinking…
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-100 flex items-center gap-2">
            {voiceSupported && (
              <button
                onClick={toggleMic}
                className={`p-2.5 rounded-xl shrink-0 ${listening ? 'bg-red-500 text-white animate-pulse' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                title={listening ? 'Stop listening' : 'Push to talk'}
              >
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && input.trim() && !busy) { conversationRef.current = false; void send(input.trim()); } }}
              placeholder={listening ? 'Listening…' : 'Ask or command…'}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-brand-400"
            />
            <button
              onClick={() => { if (input.trim() && !busy) { conversationRef.current = false; void send(input.trim()); } }}
              disabled={!input.trim() || busy}
              className="p-2.5 bg-brand-600 text-white rounded-xl disabled:opacity-40 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
