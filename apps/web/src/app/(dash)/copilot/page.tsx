'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  BotMessageSquare, Send, Loader2, Zap, ChevronRight,
  BookOpen, FileText, Calendar, Search, ShieldCheck, Clock, X,
} from 'lucide-react';
import { apiClient } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  executed?: { action: string; result: unknown };
  ts: number;
  error?: boolean;
}

interface CopilotResponse {
  reply: string;
  language?: string;
  executed?: { action: string; result: unknown };
}

interface CommandHistory {
  text: string;
  ts: number;
}

interface QuickAction {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  placeholder: string;
  template: (v: string) => string;
  tileBg: string;
  iconColor: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'research',
    icon: BookOpen,
    label: 'Research Topic',
    description: 'Deep-dive into any subject for a YouTube video',
    placeholder: 'Enter a topic to research…',
    template: (v) => `Research this topic in depth for a YouTube video: ${v}`,
    tileBg: '#eff6ff',
    iconColor: '#3b82f6',
  },
  {
    id: 'script',
    icon: FileText,
    label: 'Script Ideas',
    description: 'Generate a detailed script outline',
    placeholder: 'Enter video title or concept…',
    template: (v) => `Generate a detailed script outline for a YouTube video titled: "${v}"`,
    tileBg: '#f5f2fd',
    iconColor: '#6D4AE0',
  },
  {
    id: 'calendar',
    icon: Calendar,
    label: 'Content Calendar',
    description: 'Plan your upload schedule',
    placeholder: 'Enter your niche or channel topic…',
    template: (v) => `Suggest a 2-week content calendar for a YouTube channel about: ${v}`,
    tileBg: '#ecfdf5',
    iconColor: '#10b981',
  },
  {
    id: 'seo',
    icon: Search,
    label: 'SEO Analysis',
    description: 'Optimized titles, tags & keywords',
    placeholder: 'Enter video topic or keyword…',
    template: (v) => `Analyze the SEO potential and suggest optimized titles, tags, and keywords for: ${v}`,
    tileBg: '#fefce8',
    iconColor: '#d97706',
  },
  {
    id: 'factcheck',
    icon: ShieldCheck,
    label: 'Fact Check',
    description: 'Verify claims before you publish',
    placeholder: 'Enter a claim to fact-check…',
    template: (v) => `Fact-check this claim for my YouTube video: "${v}"`,
    tileBg: '#f0fdfa',
    iconColor: '#0d9488',
  },
  {
    id: 'ideas',
    icon: Zap,
    label: 'Video Ideas',
    description: 'Generate viral video concepts',
    placeholder: 'Enter your channel niche…',
    template: (v) => `Give me 10 viral YouTube video ideas for a channel focused on: ${v}`,
    tileBg: '#fdf2f8',
    iconColor: '#ec4899',
  },
];

const PROMPT_CHIPS = [
  "What topics are trending in my niche?",
  "Suggest 5 video ideas for next week",
  "Review my recent scripts for compliance",
  "Plan a 2-week content calendar",
];

const HISTORY_KEY = 'cf_copilot_history';
const MAX_HISTORY = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function relTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function loadHistory(): CommandHistory[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as CommandHistory[]; }
  catch { return []; }
}

function saveToHistory(text: string) {
  const existing = loadHistory().filter((h) => h.text !== text);
  const updated = [{ text, ts: Date.now() }, ...existing].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

const GREETING: Message = {
  id: 'greeting',
  role: 'assistant',
  content: "Hi! I'm your CreatorForce Copilot. I can help you research topics, generate script ideas, plan your content calendar, analyze SEO, and more. What would you like to create today?",
  ts: Date.now(),
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CopilotPage() {
  const [messages, setMessages]       = useState<Message[]>([GREETING]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [userName, setUserName]       = useState('C');
  const [history, setHistory]         = useState<CommandHistory[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionInput, setActionInput] = useState('');
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
    try {
      const token = localStorage.getItem('cf_token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { name?: string; email?: string };
        const name = payload.name || payload.email?.split('@')[0] || 'C';
        setUserName(name[0]?.toUpperCase() ?? 'C');
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput('');
    setActiveAction(null);
    setActionInput('');
    saveToHistory(trimmed);
    setHistory(loadHistory());

    const userMsg: Message = { id: uid(), role: 'user', content: trimmed, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const allMsgs = [...messages, userMsg];
      const hist = allMsgs
        .filter((m) => !m.error)
        .slice(-10)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await apiClient.post<CopilotResponse>('/copilot/chat', {
        messages: hist,
        inputMode: 'text',
      });

      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: res.data.reply, executed: res.data.executed, ts: Date.now() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: 'Sorry, something went wrong. Please try again.', ts: Date.now(), error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input); }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }

  function handleQuickActionSubmit(action: QuickAction) {
    if (!actionInput.trim()) return;
    void sendMessage(action.template(actionInput.trim()));
  }

  const currentAction = QUICK_ACTIONS.find((a) => a.id === activeAction);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-[#faf9ff]">

      {/* ── Left sidebar ───────────────────────────────────────────────── */}
      <aside
        className="w-72 shrink-0 bg-white flex-col overflow-hidden hidden md:flex"
        style={{ borderRight: '1.5px solid #e3ddf8' }}
      >
        {/* Quick Actions */}
        <div className="p-4" style={{ borderBottom: '1.5px solid #f0edf9' }}>
          <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3">
            Quick Actions
          </p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              const isActive = activeAction === action.id;
              return (
                <button
                  key={action.id}
                  onClick={() => { setActiveAction(isActive ? null : action.id); setActionInput(''); }}
                  className="flex flex-col items-start gap-2 p-3 rounded-2xl text-left transition-all hover:-translate-y-0.5"
                  style={
                    isActive
                      ? { background: '#f5f2fd', border: '2px solid #6D4AE0' }
                      : { background: '#faf9ff', border: '1.5px solid #e3ddf8' }
                  }
                >
                  <div
                    className="w-7 h-7 rounded-xl flex items-center justify-center"
                    style={{ background: action.tileBg }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: action.iconColor }} />
                  </div>
                  <span
                    className="text-xs font-bold leading-tight"
                    style={{ color: isActive ? '#6D4AE0' : '#374151' }}
                  >
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Expanded action input */}
          {currentAction && (
            <div className="mt-3 p-3 rounded-2xl" style={{ background: '#f5f2fd', border: '1.5px solid #e3ddf8' }}>
              <p className="text-[11px] text-[#6D4AE0] font-semibold mb-2">{currentAction.description}</p>
              <input
                autoFocus
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleQuickActionSubmit(currentAction); }}
                placeholder={currentAction.placeholder}
                className="w-full text-xs px-3 py-2 bg-white rounded-xl outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => handleQuickActionSubmit(currentAction)}
                  disabled={!actionInput.trim()}
                  className="flex-1 text-xs py-2 rounded-xl font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
                >
                  Go
                </button>
                <button
                  onClick={() => { setActiveAction(null); setActionInput(''); }}
                  className="w-8 flex items-center justify-center rounded-xl transition-colors hover:bg-white"
                  style={{ border: '1.5px solid #e3ddf8' }}
                >
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Recent history */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Recent
          </p>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-6 leading-relaxed">
              Your recent prompts will appear here
            </p>
          ) : (
            <div className="space-y-1">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => setInput(h.text)}
                  className="w-full text-left px-3 py-2.5 rounded-xl transition-all hover:border-[#6D4AE0]/30 group"
                  style={{ border: '1.5px solid transparent' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f5f2fd'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#e3ddf8'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; }}
                >
                  <p className="text-xs text-gray-700 truncate font-medium group-hover:text-[#6D4AE0]">{h.text}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{relTime(h.ts)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── Chat panel ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Chat header */}
        <div
          className="flex-shrink-0 px-6 py-4 flex items-center gap-3"
          style={{ background: 'linear-gradient(145deg, #4f2ec4 0%, #6D4AE0 55%, #7c5ae8 100%)' }}
        >
          <div className="w-10 h-10 bg-white/15 rounded-2xl flex items-center justify-center">
            <BotMessageSquare className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-white font-extrabold text-base leading-tight">AI Copilot</h1>
            <p className="text-white/70 text-xs">Your intelligent content assistant · powered by Claude</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white/80 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-green-300 animate-pulse" />
            Online
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 bg-[#faf9ff]">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-2xl flex items-center justify-center text-xs font-extrabold flex-shrink-0 mt-0.5 text-white"
                style={
                  msg.role === 'assistant'
                    ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }
                    : { background: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)' }
                }
              >
                {msg.role === 'assistant' ? <Zap className="w-3.5 h-3.5" /> : userName}
              </div>

              <div className={`max-w-[78%] flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user' ? 'rounded-tr-sm text-white' : 'rounded-tl-sm text-gray-800 bg-white'
                  } ${msg.error ? '' : ''}`}
                  style={
                    msg.role === 'user'
                      ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 2px 12px rgba(109,74,224,0.25)' }
                      : msg.error
                      ? { border: '1.5px solid #fecaca', background: '#fff5f5' }
                      : { border: '1.5px solid #e3ddf8', boxShadow: '0 1px 4px rgba(109,74,224,0.06)' }
                  }
                >
                  <span className={`whitespace-pre-wrap ${msg.error ? 'text-red-600' : ''}`}>{msg.content}</span>
                </div>

                {/* Executed action chip */}
                {msg.executed && (
                  <div
                    className="mt-1 px-3 py-2 rounded-2xl text-xs w-full"
                    style={{ background: '#ecfdf5', border: '1.5px solid #a7f3d0', color: '#065f46' }}
                  >
                    <span className="font-bold">✓ Action: {msg.executed.action}</span>
                    {typeof msg.executed.result === 'string' && (
                      <p className="mt-0.5 text-green-600">{msg.executed.result}</p>
                    )}
                  </div>
                )}

                <span className="text-[11px] text-gray-400 px-1">{relTime(msg.ts)}</span>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="flex gap-3">
              <div
                className="w-8 h-8 rounded-2xl flex items-center justify-center flex-shrink-0 text-white"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
              >
                <Zap className="w-3.5 h-3.5" />
              </div>
              <div
                className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2"
                style={{ border: '1.5px solid #e3ddf8', boxShadow: '0 1px 4px rgba(109,74,224,0.06)' }}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6D4AE0]" />
                <span className="text-sm text-gray-500">Copilot is thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Prompt chips */}
        {messages.length <= 1 && !loading && (
          <div className="flex-shrink-0 px-4 pb-3 flex gap-2 flex-wrap bg-[#faf9ff]">
            {PROMPT_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => void sendMessage(chip)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white rounded-full text-xs text-gray-600 font-medium transition-all hover:text-[#6D4AE0] hover:border-[#6D4AE0]/40 whitespace-nowrap"
                style={{ border: '1.5px solid #e3ddf8' }}
              >
                <ChevronRight className="w-3 h-3 text-gray-400" />
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="flex-shrink-0 bg-white px-4 py-3" style={{ borderTop: '1.5px solid #e3ddf8' }}>
          <div className="flex items-end gap-2.5 max-w-3xl mx-auto">
            <div
              className="flex-1 bg-white rounded-2xl flex items-end transition-all focus-within:ring-2 focus-within:ring-[#6D4AE0]/20 focus-within:border-[#6D4AE0]"
              style={{ border: '1.5px solid #e3e0f0' }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                disabled={loading}
                placeholder="Ask anything about your content…"
                rows={1}
                className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none disabled:opacity-50 max-h-24 leading-relaxed"
              />
            </div>
            <button
              type="button"
              onClick={() => void sendMessage(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="w-10 h-10 flex items-center justify-center rounded-2xl text-white flex-shrink-0 transition-all hover:opacity-90 disabled:opacity-40 active:scale-[0.96]"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 2px 10px rgba(109,74,224,0.30)' }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center text-[11px] text-gray-400 mt-1.5">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
