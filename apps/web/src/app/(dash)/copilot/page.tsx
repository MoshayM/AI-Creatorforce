'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  BotMessageSquare, Send, Loader2, Zap, ChevronRight, BookOpen,
  FileText, Calendar, Search, ShieldCheck, Clock, X,
} from 'lucide-react';
import { apiClient } from '@/lib/api';

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
  color: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'research',
    icon: BookOpen,
    label: 'Research Topic',
    description: 'Deep-dive into any subject',
    placeholder: 'Enter a topic to research…',
    template: (v) => `Research this topic in depth for a YouTube video: ${v}`,
    color: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200',
  },
  {
    id: 'script',
    icon: FileText,
    label: 'Script Ideas',
    description: 'Generate video script concepts',
    placeholder: 'Enter video title or concept…',
    template: (v) => `Generate a detailed script outline for a YouTube video titled: "${v}"`,
    color: 'bg-violet-50 text-violet-700 hover:bg-violet-100 border-violet-200',
  },
  {
    id: 'calendar',
    icon: Calendar,
    label: 'Content Calendar',
    description: 'Plan your content schedule',
    placeholder: 'Enter your niche or channel topic…',
    template: (v) => `Suggest a 2-week content calendar for a YouTube channel about: ${v}`,
    color: 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200',
  },
  {
    id: 'seo',
    icon: Search,
    label: 'SEO Analysis',
    description: 'Optimize titles and keywords',
    placeholder: 'Enter video topic or keyword…',
    template: (v) => `Analyze the SEO potential and suggest optimized titles, tags, and keywords for: ${v}`,
    color: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200',
  },
  {
    id: 'factcheck',
    icon: ShieldCheck,
    label: 'Fact Check',
    description: 'Verify claims and sources',
    placeholder: 'Enter a claim to fact-check…',
    template: (v) => `Fact-check this claim for my YouTube video: "${v}"`,
    color: 'bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-200',
  },
  {
    id: 'ideas',
    icon: Zap,
    label: 'Video Ideas',
    description: 'Generate viral video concepts',
    placeholder: 'Enter your channel niche…',
    template: (v) => `Give me 10 viral YouTube video ideas for a channel focused on: ${v}`,
    color: 'bg-pink-50 text-pink-700 hover:bg-pink-100 border-pink-200',
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

function uid() {
  return Math.random().toString(36).slice(2);
}

function relTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function loadHistory(): CommandHistory[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as CommandHistory[];
  } catch { return []; }
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

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState('C');
  const [history, setHistory] = useState<CommandHistory[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionInput, setActionInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
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
      const history = allMsgs
        .filter((m) => !m.error)
        .slice(-10)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await apiClient.post<CopilotResponse>('/copilot/chat', {
        messages: history,
        inputMode: 'text',
      });

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          content: res.data.reply,
          executed: res.data.executed,
          ts: Date.now(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
          ts: Date.now(),
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
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
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left panel */}
      <div className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden hidden md:flex">
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              const isActive = activeAction === action.id;
              return (
                <button
                  key={action.id}
                  onClick={() => {
                    setActiveAction(isActive ? null : action.id);
                    setActionInput('');
                  }}
                  className={`flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all ${
                    isActive
                      ? action.color + ' ring-2 ring-offset-1 ring-current/30'
                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium leading-tight">{action.label}</span>
                </button>
              );
            })}
          </div>

          {/* Action input */}
          {currentAction && (
            <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
              <p className="text-xs text-gray-500 mb-2">{currentAction.description}</p>
              <input
                autoFocus
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleQuickActionSubmit(currentAction); }}
                placeholder={currentAction.placeholder}
                className="w-full text-xs px-2.5 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white"
              />
              <div className="flex gap-1.5 mt-2">
                <button
                  onClick={() => handleQuickActionSubmit(currentAction)}
                  disabled={!actionInput.trim()}
                  className="flex-1 text-xs py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40 transition-colors"
                >
                  Go
                </button>
                <button
                  onClick={() => { setActiveAction(null); setActionInput(''); }}
                  className="px-2.5 text-xs py-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Recent commands */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Recent
          </p>
          {history.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-4">Your recent prompts will appear here</p>
          ) : (
            <div className="space-y-1">
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => setInput(h.text)}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <p className="text-xs text-gray-700 truncate group-hover:text-violet-700">{h.text}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{relTime(h.ts)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
            <BotMessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-tight">AI Copilot</h1>
            <p className="text-white/70 text-xs">Your intelligent content assistant</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                msg.role === 'assistant'
                  ? 'bg-gradient-to-br from-violet-500 to-purple-700'
                  : 'bg-gradient-to-br from-gray-400 to-gray-600'
              } text-white`}>
                {msg.role === 'assistant' ? <Zap className="w-3.5 h-3.5" /> : userName}
              </div>

              <div className={`max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                <div className={
                  msg.role === 'user'
                    ? 'bg-[#7a63cb] text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm'
                    : `bg-white border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm shadow-sm text-gray-800 ${msg.error ? 'border-red-200 text-red-600' : 'border-gray-100'}`
                }>
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                </div>

                {msg.executed && (
                  <div className="mt-1 px-3 py-2 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 w-full">
                    <span className="font-semibold">Action: {msg.executed.action}</span>
                    {typeof msg.executed.result === 'string' && (
                      <p className="mt-0.5 text-green-600">{msg.executed.result}</p>
                    )}
                  </div>
                )}

                <span className="text-xs text-gray-400 px-1">{relTime(msg.ts)}</span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center flex-shrink-0">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                <span className="text-sm text-gray-500">Copilot is thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Prompt chips */}
        {messages.length <= 1 && !loading && (
          <div className="flex-shrink-0 px-4 pb-2 flex gap-2 flex-wrap bg-gray-50">
            {PROMPT_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => void sendMessage(chip)}
                className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:border-violet-300 hover:bg-violet-50 transition-colors whitespace-nowrap"
              >
                <ChevronRight className="w-3 h-3 text-gray-400" />
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
          <div className="flex items-end gap-2 max-w-3xl mx-auto">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Ask anything about your content…"
              rows={1}
              className="flex-1 resize-none rounded-2xl border border-gray-200 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent disabled:opacity-50 max-h-24 leading-relaxed"
            />
            <button
              type="button"
              onClick={() => void sendMessage(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="w-10 h-10 flex items-center justify-center bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full disabled:opacity-40 transition-colors flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 mt-1.5">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
