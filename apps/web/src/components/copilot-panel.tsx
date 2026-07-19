'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, X, Send, Mic, MicOff, Volume2, VolumeX, ShieldCheck, Building2, MessageSquare } from 'lucide-react';
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
  const [showChat, setShowChat] = useState(false);
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
  // Phase 5 §10: bill turns (chat + voice) to an org shared wallet; '' = personal
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [billingOrgId, setBillingOrgId] = useState('');

  // Listen for cf:open-copilot custom event (dispatched from topbar button)
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('cf:open-copilot', handler as EventListener);
    return () => window.removeEventListener('cf:open-copilot', handler as EventListener);
  }, []);

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

  // speakReplies toggle is available via the voice orb panel (kept for future use)
  void setSpeakReplies;

  return (
    <>
      {open && (
        <div
          onClick={() => { conversationRef.current = false; recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); setOpen(false); setShowChat(false); }}
          className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in-cf"
          style={{background:'rgba(30,27,46,.14)',backdropFilter:'blur(1.5px)'}}
        >
          <div onClick={e => e.stopPropagation()} className="flex flex-col items-center gap-6 animate-pop-in">

            {/* Voice orb — animations only when listening or processing; static during idle */}
            <div style={{position:'relative',width:'220px',height:'220px',display:'flex',alignItems:'center',justifyContent:'center'}}>
              {/* Ripple rings: only during listening */}
              <div style={{position:'absolute',inset:0,borderRadius:'50%',border:'2px solid rgba(139,92,246,.35)',animation: listening ? 'ripple 2.4s ease-out infinite' : 'none',opacity: listening ? 1 : 0,transition:'opacity .4s'}} />
              <div style={{position:'absolute',inset:0,borderRadius:'50%',border:'2px solid rgba(139,92,246,.25)',animation: listening ? 'ripple 2.4s ease-out infinite' : 'none',animationDelay:'1.2s',opacity: listening ? 1 : 0,transition:'opacity .4s'}} />
              <div
                style={{
                  position:'relative',width:'132px',height:'132px',borderRadius:'50%',
                  background:'linear-gradient(135deg,#9C88DD,#7E62C9)',
                  display:'flex',alignItems:'center',justifyContent:'center',gap:'5px',
                  /* pulseGlow only when processing; subtle static shadow at idle */
                  animation: busy ? 'pulseGlow 2.4s ease-in-out infinite' : 'none',
                  boxShadow: busy ? undefined : '0 8px 24px -8px rgba(124,58,237,.5)',
                  transition:'box-shadow .4s',
                }}
              >
                {[
                  {h:'22px',d:'0s'},{h:'44px',d:'.15s'},{h:'64px',d:'.3s'},{h:'40px',d:'.45s'},
                  {h:'70px',d:'.2s'},{h:'36px',d:'.35s'},{h:'20px',d:'.5s'},
                ].map((bar, i) => (
                  <span
                    key={i}
                    style={{
                      width:'6px',
                      /* bars animate only during voice activity; otherwise collapse to flat dots */
                      height: listening ? bar.h : busy ? bar.h : '6px',
                      borderRadius:'6px',
                      background:'#fff',
                      animation: listening ? `voiceBar 1s ease-in-out infinite` : 'none',
                      animationDelay: bar.d,
                      transition:'height .35s cubic-bezier(.4,0,.2,1)',
                      opacity: listening ? 1 : busy ? 0.6 : 0.35,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Status */}
            <div style={{textAlign:'center'}}>
              <div
                style={{display:'inline-flex',alignItems:'center',gap:'8px',fontSize:'15px',fontWeight:700,color:'#fff',background:'rgba(30,27,46,.55)',backdropFilter:'blur(6px)',padding:'9px 18px',borderRadius:'30px'}}
              >
                <span style={{
                  width:'9px',height:'9px',borderRadius:'50%',flexShrink:0,
                  background: listening ? '#4ADE80' : busy ? '#FBBF24' : 'rgba(255,255,255,.45)',
                  boxShadow: listening ? '0 0 0 4px rgba(74,222,128,.25)' : busy ? '0 0 0 4px rgba(251,191,36,.25)' : 'none',
                  transition:'background .3s, box-shadow .3s',
                }} />
                {listening ? 'Listening… speak naturally' : busy ? 'Processing…' : 'Copilot ready'}
              </div>
              <p style={{fontSize:'12.5px',color:'rgba(30,27,46,.55)',fontWeight:600,marginTop:'10px'}}>
                {messages.length > 0
                  ? (messages[messages.length - 1]?.content ?? '').slice(0, 80) + ((messages[messages.length - 1]?.content?.length ?? 0) > 80 ? '…' : '')
                  : 'Ask me anything about your content'}
              </p>
            </div>

            {/* Controls */}
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <button
                type="button"
                title={listening ? 'Stop listening' : 'Start listening'}
                onClick={e => { e.stopPropagation(); toggleMic(); }}
                style={{width:'52px',height:'52px',borderRadius:'50%',background:'#fff',color:'#6b6880',display:'flex',alignItems:'center',justifyContent:'center',border:'none',cursor:'pointer',boxShadow:'0 10px 26px -12px rgba(30,27,46,.5)'}}
              >
                {listening ? <MicOff style={{width:'22px',height:'22px'}} /> : <Mic style={{width:'22px',height:'22px'}} />}
              </button>

              <button
                type="button"
                title="Type a message"
                onClick={e => { e.stopPropagation(); setShowChat(c => !c); }}
                style={{width:'52px',height:'52px',borderRadius:'50%',background:'#fff',color:'#6b6880',display:'flex',alignItems:'center',justifyContent:'center',border:'none',cursor:'pointer',boxShadow:'0 10px 26px -12px rgba(30,27,46,.5)'}}
              >
                <MessageSquare style={{width:'22px',height:'22px'}} />
              </button>

              <button
                type="button"
                title="Close"
                onClick={e => { e.stopPropagation(); conversationRef.current = false; recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); setOpen(false); setShowChat(false); }}
                style={{width:'64px',height:'64px',borderRadius:'50%',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',border:'none',cursor:'pointer',background:'linear-gradient(135deg,#F87171,#EF4444)',boxShadow:'0 12px 30px -12px rgba(239,68,68,.7)'}}
              >
                <X style={{width:'26px',height:'26px'}} />
              </button>
            </div>

            {/* Text input */}
            {showChat && (
              <div
                onClick={e => e.stopPropagation()}
                style={{width:'400px',maxWidth:'calc(100vw - 3rem)',background:'#fff',borderRadius:'16px',padding:'12px',display:'flex',gap:'8px',boxShadow:'0 20px 50px -20px rgba(30,27,46,.5)'}}
              >
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey && input.trim()) { e.preventDefault(); void send(input.trim()); }}}
                  placeholder="Type a message…"
                  style={{flex:'1 1 auto',border:'none',outline:'none',fontSize:'14px',color:'#1E1B2E',background:'transparent',fontFamily:'inherit'}}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!input.trim() || busy}
                  onClick={() => { if (input.trim()) void send(input.trim()); }}
                  style={{width:'32px',height:'32px',borderRadius:'10px',background:'#7C3AED',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',border:'none',cursor:'pointer',opacity: (!input.trim() || busy) ? 0.4 : 1}}
                >
                  <Send style={{width:'16px',height:'16px'}} />
                </button>
              </div>
            )}

            {/* Confirmation card */}
            {pending && (
              <div
                onClick={e => e.stopPropagation()}
                style={{width:'360px',maxWidth:'calc(100vw - 3rem)',borderRadius:'16px',border:'1px solid #fde68a',background:'#fffbeb',padding:'16px',boxShadow:'0 20px 50px -20px rgba(30,27,46,.4)'}}
              >
                <p style={{display:'flex',alignItems:'center',gap:'6px',color:'#92400e',fontWeight:600,fontSize:'13px',marginBottom:'4px'}}>
                  <ShieldCheck style={{width:'16px',height:'16px'}} /> Confirm: {pending.action.replace(/_/g,' ')}
                </p>
                <p style={{fontSize:'12px',color:'#b45309',marginBottom:'12px'}}>
                  {pendingEstimate !== null ? `Estimated: ${pendingEstimate.toLocaleString()} credits` : 'Cost varies — charged at actual usage'}
                </p>
                <div style={{display:'flex',gap:'8px'}}>
                  <button onClick={() => void send('', pending)} style={{padding:'6px 12px',background:'#7C3AED',color:'#fff',borderRadius:'9px',fontSize:'12px',fontWeight:600,border:'none',cursor:'pointer'}}>Confirm</button>
                  <button onClick={() => { setPending(null); setPendingEstimate(null); }} style={{padding:'6px 12px',background:'#f3f4f6',color:'#374151',borderRadius:'9px',fontSize:'12px',fontWeight:600,border:'none',cursor:'pointer'}}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Agent activity panel */}
          <div
            onClick={e => e.stopPropagation()}
            className="fixed bottom-6 right-6 z-[51] flex flex-col gap-3.5 animate-pop-in"
            style={{
              top:'84px',width:'340px',
              background:'rgba(20,17,34,.5)',backdropFilter:'blur(16px)',
              border:'1px solid rgba(255,255,255,.14)',borderRadius:'20px',
              padding:'18px 16px',
              boxShadow:'0 30px 70px -30px rgba(0,0,0,.6)',
            }}
          >
            <div style={{display:'flex',alignItems:'center',gap:'9px',padding:'0 4px'}}>
              <span style={{width:'8px',height:'8px',borderRadius:'50%',background:'#4ADE80',boxShadow:'0 0 0 4px rgba(74,222,128,.22)',flexShrink:0}} />
              <div style={{fontSize:'13px',fontWeight:700,color:'#fff'}}>Agent activity</div>
              <div style={{flex:'1 1 auto'}} />
              <div style={{fontSize:'11px',fontWeight:600,color:'rgba(255,255,255,.5)'}}>live</div>
            </div>
            <div ref={listRef} style={{flex:'1 1 auto',overflowY:'auto',display:'flex',flexDirection:'column',gap:'13px',padding:'2px 4px'}}>
              {messages.length === 0 ? (
                <div style={{fontSize:'12px',color:'rgba(255,255,255,.4)',fontWeight:500,marginTop:'8px'}}>No activity yet.</div>
              ) : (
                messages.slice(-8).map((m, i) => (
                  <div key={i} style={{display:'flex',alignItems:'flex-start',gap:'8px',opacity: m.role==='user' ? 0.6 : 1}}>
                    <span style={{width:'22px',height:'22px',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0,fontSize:'11px',fontWeight:700,background: m.role==='user' ? 'rgba(255,255,255,.2)' : 'rgba(124,58,237,.8)'}}>
                      {m.role==='user' ? 'U' : 'AI'}
                    </span>
                    <div style={{fontSize:'12px',color:'rgba(255,255,255,.8)',fontWeight:500,lineHeight:1.45}}>
                      {m.content.slice(0,120)}{m.content.length>120?'…':''}
                    </div>
                  </div>
                ))
              )}
              {busy && (
                <div style={{display:'flex',alignItems:'center',gap:'8px',paddingLeft:'2px'}}>
                  <span style={{width:'6px',height:'6px',borderRadius:'50%',background:'#A855F7',animation:'voiceBar .9s ease-in-out infinite'}} />
                  <span style={{fontSize:'12px',color:'rgba(255,255,255,.5)',fontWeight:500}}>Processing…</span>
                </div>
              )}
            </div>
            {orgs.length > 0 && (
              <div style={{display:'flex',alignItems:'center',gap:'8px',borderTop:'1px solid rgba(255,255,255,.1)',paddingTop:'12px'}}>
                <Building2 style={{width:'14px',height:'14px',color:'rgba(255,255,255,.5)',flexShrink:0}} />
                <select value={billingOrgId} onChange={e => setBillingOrgId(e.target.value)} style={{flex:'1 1 auto',fontSize:'11px',color:'rgba(255,255,255,.7)',background:'rgba(255,255,255,.1)',border:'1px solid rgba(255,255,255,.2)',borderRadius:'6px',padding:'4px 8px'}}>
                  <option value="">Personal wallet</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
