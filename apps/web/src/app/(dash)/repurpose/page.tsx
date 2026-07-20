'use client';
import { useState } from 'react';
import {
  ArrowRightLeft, Loader2, Copy, Check, ChevronDown, ChevronUp,
  Film, Instagram, Twitter, Linkedin, Mail, Smartphone, Sparkles,
} from 'lucide-react';
import { apiClient } from '@/lib/api';

type Platform = 'shorts' | 'instagram' | 'tiktok' | 'twitter' | 'linkedin' | 'newsletter';

interface RepurposeItem {
  platform: Platform;
  headline: string;
  content: string;
  hashtags: string[];
  callToAction: string;
  durationNote: string;
  visualTips: string[];
  hook: string;
}

interface RepurposeResult {
  originalTitle: string;
  summary: string;
  items: RepurposeItem[];
}

const PLATFORM_META: Record<Platform, { label: string; icon: React.ElementType; color: string; bg: string; border: string }> = {
  shorts: { label: 'YouTube Shorts', icon: Film, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
  instagram: { label: 'Instagram Reel', icon: Instagram, color: 'text-pink-700', bg: 'bg-pink-50', border: 'border-pink-200' },
  tiktok: { label: 'TikTok', icon: Smartphone, color: 'text-gray-900', bg: 'bg-gray-50', border: 'border-gray-200' },
  twitter: { label: 'Twitter / X Thread', icon: Twitter, color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
  linkedin: { label: 'LinkedIn Post', icon: Linkedin, color: 'text-blue-800', bg: 'bg-blue-50', border: 'border-blue-200' },
  newsletter: { label: 'Newsletter Teaser', icon: Mail, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
};

const ALL_PLATFORMS: Platform[] = ['shorts', 'instagram', 'tiktok', 'twitter', 'linkedin', 'newsletter'];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-2xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function PlatformCard({ item }: { item: RepurposeItem }) {
  const [expanded, setExpanded] = useState(true);
  const meta = PLATFORM_META[item.platform];
  const Icon = meta.icon;

  const fullText = [
    item.hook && `Hook: ${item.hook}`,
    item.content,
    item.hashtags.length > 0 && item.hashtags.map((h) => `#${h}`).join(' '),
    item.callToAction && `CTA: ${item.callToAction}`,
  ].filter(Boolean).join('\n\n');

  return (
    <div className={`rounded-2xl overflow-hidden ${meta.border}`} style={{ border: `1.5px solid` }}>
      <div className={`flex items-center justify-between px-5 py-3.5 ${meta.bg}`}>
        <div className="flex items-center gap-2.5">
          <Icon className={`w-5 h-5 ${meta.color}`} />
          <span className={`font-semibold text-sm ${meta.color}`}>{meta.label}</span>
          {item.durationNote && (
            <span className="text-xs text-gray-500 font-mono">{item.durationNote}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <CopyButton text={fullText} />
          <button
            onClick={() => setExpanded((v) => !v)}
            className={`p-1.5 rounded-2xl hover:bg-white/60 ${meta.color} transition-colors`}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-5 space-y-4 bg-white">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Headline</p>
            <p className="font-semibold text-gray-900">{item.headline}</p>
          </div>

          {item.hook && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Hook</p>
              <p className="text-sm text-gray-700 italic">&ldquo;{item.hook}&rdquo;</p>
            </div>
          )}

          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Content</p>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{item.content}</p>
          </div>

          {item.hashtags.length > 0 && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1.5">Hashtags</p>
              <div className="flex flex-wrap gap-1.5">
                {item.hashtags.map((tag, i) => (
                  <span key={i} className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.color}`}>#{tag}</span>
                ))}
              </div>
            </div>
          )}

          {item.callToAction && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Call to Action</p>
              <p className="text-sm text-gray-600">{item.callToAction}</p>
            </div>
          )}

          {item.visualTips && item.visualTips.length > 0 && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1.5">Visual Tips</p>
              <ul className="space-y-1">
                {item.visualTips.map((tip, i) => (
                  <li key={i} className="text-xs text-gray-500 flex items-start gap-1.5">
                    <span className="text-gray-300 mt-0.5">•</span> {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RepurposePage() {
  const [title, setTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set(['shorts', 'instagram', 'twitter']));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RepurposeResult | null>(null);

  const togglePlatform = (p: Platform) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) { next.delete(p); } else { next.add(p); }
      return next;
    });
  };

  const handleRepurpose = async () => {
    if (!scriptText.trim() || selectedPlatforms.size === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiClient.post<RepurposeResult>('/content/repurpose', {
        scriptText: scriptText.trim(),
        title: title.trim() || 'Untitled Video',
        platforms: Array.from(selectedPlatforms),
      });
      setResult(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to repurpose content';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const wordCount = scriptText.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6" style={{ color: '#6D4AE0' }} /> Content Repurposer
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Adapt your YouTube script into native content for every platform</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Left: Input */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl p-5 space-y-4" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="font-semibold text-gray-800 text-sm">Source Content</h2>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Video title <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. How to start a YouTube channel"
                  className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                  style={{ border: '1.5px solid #e3e0f0' }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Script or video description
                  {wordCount > 0 && <span className="text-gray-400 ml-2">{wordCount} words</span>}
                </label>
                <textarea
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder="Paste your video script, summary, or key talking points here..."
                  rows={12}
                  className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 resize-none"
                  style={{ border: '1.5px solid #e3e0f0' }}
                />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="font-semibold text-gray-800 text-sm mb-3">Target Platforms</h2>
              <div className="space-y-2">
                {ALL_PLATFORMS.map((p) => {
                  const meta = PLATFORM_META[p];
                  const Icon = meta.icon;
                  const selected = selectedPlatforms.has(p);
                  return (
                    <label key={p} className={`flex items-center gap-3 p-2.5 rounded-2xl border cursor-pointer transition-all ${selected ? `${meta.bg} ${meta.border}` : 'border-transparent hover:bg-gray-50'}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => togglePlatform(p)}
                        className="sr-only"
                      />
                      <Icon className={`w-4 h-4 ${selected ? meta.color : 'text-gray-400'}`} />
                      <span className={`text-sm font-medium ${selected ? meta.color : 'text-gray-600'}`}>{meta.label}</span>
                      {selected && <Check className={`w-3.5 h-3.5 ml-auto ${meta.color}`} />}
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleRepurpose}
              disabled={loading || !scriptText.trim() || selectedPlatforms.size === 0}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl font-bold text-white disabled:opacity-50 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              {loading ? 'Repurposing…' : `Repurpose for ${selectedPlatforms.size} platform${selectedPlatforms.size !== 1 ? 's' : ''}`}
            </button>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-3 py-2">{error}</p>
            )}
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-3">
            {!result && !loading && (
              <div className="h-full flex flex-col items-center justify-center text-center py-20 bg-white rounded-3xl" style={{ border: '1.5px solid #e3ddf8' }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
                  <ArrowRightLeft className="w-8 h-8" style={{ color: '#6D4AE0' }} />
                </div>
                <p className="font-medium text-gray-500">Your adapted content will appear here</p>
                <p className="text-sm mt-1 text-gray-400">Select platforms and paste your script to get started</p>
              </div>
            )}

            {loading && (
              <div className="h-full flex flex-col items-center justify-center py-20 text-gray-500">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-[#6D4AE0]" />
                <p className="font-medium">Adapting for {selectedPlatforms.size} platforms…</p>
                <p className="text-sm mt-1 text-gray-400">This may take a moment</p>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {result.summary && (
                  <div className="bg-[#f5f2fd] rounded-2xl px-4 py-3" style={{ border: '1.5px solid #e3ddf8' }}>
                    <p className="text-sm text-gray-700">{result.summary}</p>
                  </div>
                )}
                {result.items.map((item, i) => (
                  <PlatformCard key={i} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
