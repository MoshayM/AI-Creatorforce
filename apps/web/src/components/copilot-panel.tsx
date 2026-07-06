'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, X, Send, Mic, MicOff, Loader2, Volume2, VolumeX, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CopilotResponse {
  reply: string;
  executed?: { action: string; result: unknown };
  needsConfirmation?: Record<string, unknown> & { action: string };
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
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const voiceSupported = typeof window !== 'undefined' && !!getRecognition();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, busy]);

  const speak = useCallback((text: string) => {
    if (!speakReplies || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // barge-in: new reply interrupts the old one
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, [speakReplies]);

  const send = useCallback(async (text: string, confirmedCommand?: Record<string, unknown>) => {
    const nextMessages: ChatMessage[] = text
      ? [...messages, { role: 'user' as const, content: text }]
      : messages;
    if (text) setMessages(nextMessages);
    setInput('');
    setPending(null);
    setBusy(true);
    try {
      const res = await apiClient.post('/copilot/chat', {
        messages: nextMessages.slice(-10),
        ...(confirmedCommand ? { confirmedCommand } : {}),
      });
      const data = res.data as CopilotResponse;
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
      if (data.needsConfirmation) setPending(data.needsConfirmation);
      speak(data.reply);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessages((m) => [...m, { role: 'assistant', content: `Something went wrong: ${e.response?.data?.message ?? 'request failed'}` }]);
    } finally {
      setBusy(false);
    }
  }, [messages, speak]);

  const toggleMic = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    rec.lang = 'en-US';
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
      if (finalText.trim()) void send(finalText.trim());
    };
    rec.onerror = () => setListening(false);
    window.speechSynthesis?.cancel(); // barge-in
    rec.start();
    setListening(true);
  }, [listening, send]);

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-b from-[#9d6ff0] to-[#7c4fd8] text-white shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
          title="Copilot — type or speak to control the pipeline"
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
            <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-xs text-gray-400 space-y-2">
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
                </div>
              </div>
            ))}
            {pending && (
              <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 text-sm">
                <p className="flex items-center gap-1.5 text-amber-800 font-medium text-xs mb-2">
                  <ShieldCheck className="w-4 h-4" /> Confirm: {pending.action.replace(/_/g, ' ')}
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
              <div className="flex items-center gap-2 text-gray-400 text-xs">
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
              onKeyDown={(e) => { if (e.key === 'Enter' && input.trim() && !busy) void send(input.trim()); }}
              placeholder={listening ? 'Listening…' : 'Ask or command…'}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-brand-400"
            />
            <button
              onClick={() => input.trim() && !busy && void send(input.trim())}
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
