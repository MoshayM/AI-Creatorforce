'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, Loader2, Zap, ChevronRight } from 'lucide-react';
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

const SUGGESTIONS = [
  'What are my active projects?',
  'Show me pending approvals',
  'Generate content ideas for my channel',
];

function relTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function CopilotPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState('C');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex-shrink-0 bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] px-6 py-4 flex items-center gap-3">
        <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-white font-bold text-base leading-tight">AI Copilot</h1>
          <p className="text-white/70 text-xs">Your intelligent content assistant</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50">
        {messages.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
            <div className="w-16 h-16 bg-gradient-to-br from-violet-400 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h2 className="text-gray-900 font-bold text-lg">CreatorForce Copilot</h2>
              <p className="text-gray-500 text-sm mt-1">Ask me anything about your content, projects, or channel</p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void sendMessage(s)}
                  className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-violet-300 hover:bg-violet-50 transition-colors text-left"
                >
                  {s}
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                  msg.role === 'assistant'
                    ? 'bg-gradient-to-br from-violet-500 to-purple-700'
                    : 'bg-gradient-to-br from-gray-400 to-gray-600'
                } text-white`}>
                  {msg.role === 'assistant' ? <Zap className="w-3.5 h-3.5" /> : userName}
                </div>

                {/* Bubble */}
                <div className={`max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  <div className={
                    msg.role === 'user'
                      ? 'bg-[#7a63cb] text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm'
                      : `bg-white border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm shadow-sm text-gray-800 ${msg.error ? 'border-red-200 text-red-600' : 'border-gray-100'}`
                  }>
                    {msg.content}
                  </div>

                  {/* Executed action card */}
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
          </>
        )}
        <div ref={bottomRef} />
      </div>

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
  );
}
