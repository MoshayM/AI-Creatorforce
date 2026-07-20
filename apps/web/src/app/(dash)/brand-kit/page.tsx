'use client';
import { useState, useEffect } from 'react';
import { Palette, Mic, Save, CheckCircle, RefreshCw, Wand2 } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface Channel {
  id: string;
  title: string;
  niche?: string;
  brandKit?: {
    colorPalette?: string[];
    fontStyle?: string;
    visualMood?: string;
    thumbnailStyle?: string;
    overlayStyle?: string;
  };
  voiceProfile?: {
    name?: string;
    style?: string;
    tone?: string;
    pace?: string;
    provider?: string;
    voiceId?: string;
  };
}

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api';

async function callApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = localStorage.getItem('cf_token');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default function BrandKitPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Brand kit state
  const [niche, setNiche] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7c3aed');
  const [accentColor, setAccentColor] = useState('#a78bfa');
  const [bgColor, setBgColor] = useState('#1a1a2e');
  const [fontStyle, setFontStyle] = useState('Modern sans-serif (Inter/Poppins)');
  const [visualMood, setVisualMood] = useState('professional, clean, modern');
  const [thumbnailStyle, setThumbnailStyle] = useState('Bold text overlay, high contrast');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);

  // Voice profile
  const [voiceName, setVoiceName] = useState('Narrator');
  const [voiceStyle, setVoiceStyle] = useState('conversational');
  const [voiceTone, setVoiceTone] = useState('engaging, confident');
  const [voicePace, setVoicePace] = useState('moderate');
  const [voiceProvider, setVoiceProvider] = useState('elevenlabs');

  useEffect(() => {
    callApi<Channel[]>('/channels')
      .then(setChannels)
      .catch(() => {});
  }, []);

  function selectChannel(ch: Channel) {
    setSelected(ch);
    setNiche(ch.niche ?? '');
    setPrimaryColor(ch.brandKit?.colorPalette?.[0] ?? '#7c3aed');
    setAccentColor(ch.brandKit?.colorPalette?.[1] ?? '#a78bfa');
    setBgColor(ch.brandKit?.colorPalette?.[2] ?? '#1a1a2e');
    setFontStyle(ch.brandKit?.fontStyle ?? 'Modern sans-serif (Inter/Poppins)');
    setVisualMood(ch.brandKit?.visualMood ?? 'professional, clean, modern');
    setThumbnailStyle(ch.brandKit?.thumbnailStyle ?? 'Bold text overlay, high contrast');
    setVoiceName(ch.voiceProfile?.name ?? 'Narrator');
    setVoiceStyle(ch.voiceProfile?.style ?? 'conversational');
    setVoiceTone(ch.voiceProfile?.tone ?? 'engaging, confident');
    setVoicePace(ch.voiceProfile?.pace ?? 'moderate');
    setVoiceProvider(ch.voiceProfile?.provider ?? 'elevenlabs');
  }

  async function generateBrandIdentity() {
    if (!niche.trim() || aiGenerating) return;
    setAiGenerating(true);
    setError('');
    try {
      const res = await apiClient.post('/audience/analyze', { niche: niche.trim() });
      const audience = res.data as {
        primaryDemographic?: string;
        contentPreferences?: string[];
        interestClusters?: Array<{ cluster: string }>;
      };

      const demo = (audience.primaryDemographic ?? '').toLowerCase();
      const cluster = (audience.interestClusters?.[0]?.cluster ?? '').toLowerCase();
      const combined = `${demo} ${cluster}`;

      let primary = '#7c3aed', accent = '#a78bfa', bg = '#1a1a2e';
      let mood = 'professional, clean, modern';
      let thumb = 'Bold text overlay, high contrast, eye-catching';

      if (/tech|ai|gaming|software|developer/.test(combined)) {
        primary = '#6d28d9'; accent = '#8b5cf6'; bg = '#0f0f1a';
        mood = 'futuristic, sleek, high-tech';
        thumb = 'Dynamic text overlay, bright accents, dark bg';
      } else if (/financ|business|invest|econom|money/.test(combined)) {
        primary = '#1e40af'; accent = '#3b82f6'; bg = '#0a0e1a';
        mood = 'authoritative, trustworthy, premium';
        thumb = 'Clean, minimal, authoritative typography';
      } else if (/health|wellness|fitness|nutrition|medical/.test(combined)) {
        primary = '#065f46'; accent = '#34d399'; bg = '#0d1f17';
        mood = 'warm, natural, calming, approachable';
        thumb = 'Warm, natural, lifestyle photography';
      } else if (/entertainment|lifestyle|fashion|beauty|travel/.test(combined)) {
        primary = '#9d174d'; accent = '#f472b6'; bg = '#1a0d14';
        mood = 'vibrant, trendy, energetic, fun';
        thumb = 'Bright, colorful, lifestyle imagery with bold text';
      } else if (/educat|learn|teach|course|tutori/.test(combined)) {
        primary = '#92400e'; accent = '#fbbf24'; bg = '#1a1206';
        mood = 'clear, informative, engaging, friendly';
        thumb = 'Clean diagram overlay, warm tones, readable text';
      }

      const prefs = audience.contentPreferences ?? [];
      if (prefs.length >= 2) mood = `${prefs[0]}, ${prefs[1]}, professional`;

      setPrimaryColor(primary);
      setAccentColor(accent);
      setBgColor(bg);
      setVisualMood(mood);
      setThumbnailStyle(thumb);
      setAiGenerated(true);
      setTimeout(() => setAiGenerated(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI generation failed');
    } finally {
      setAiGenerating(false);
    }
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await callApi(`/channels/${selected.id}`, 'PATCH', {
        niche,
        brandKit: {
          colorPalette: [primaryColor, accentColor, bgColor],
          fontStyle,
          visualMood,
          thumbnailStyle,
        },
        voiceProfile: {
          name: voiceName,
          style: voiceStyle,
          tone: voiceTone,
          pace: voicePace,
          provider: voiceProvider,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <Palette className="w-7 h-7" style={{ color: '#6D4AE0' }} />
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Brand Kit</h1>
            <p className="text-sm text-gray-400 mt-0.5">Visual identity and voice profile used across all AI-generated assets</p>
          </div>
        </div>

        {/* Channel selector */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
          <span className="block text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Channel</span>
          <div className="flex gap-2 flex-wrap">
            {channels.map(ch => (
              <button
                key={ch.id}
                onClick={() => selectChannel(ch)}
                className="px-3 py-1.5 rounded-2xl text-sm font-semibold transition-all"
                style={selected?.id === ch.id
                  ? { background: '#f5f2fd', color: '#6D4AE0', border: '1.5px solid #6D4AE0' }
                  : { background: 'white', color: '#4b5563', border: '1.5px solid #e3ddf8' }
                }
              >
                {ch.title}
              </button>
            ))}
            {channels.length === 0 && (
              <p className="text-sm text-gray-400">No channels connected — go to Settings → Connect YouTube.</p>
            )}
          </div>
        </div>

        {selected && (
          <>
            {/* Niche */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Channel Niche</h2>
              <input
                type="text"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                placeholder="e.g. AI, Technology, Personal Finance, Health…"
                className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
            </div>

            {/* AI Generate */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8', background: 'linear-gradient(135deg, #faf9ff 0%, #f5f2fd 100%)' }}>
              <div className="flex items-start gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
                  <Wand2 className="w-4 h-4" style={{ color: '#6D4AE0' }} />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900">AI Generate Brand Identity</h2>
                  <p className="text-sm text-gray-400 mt-0.5">Let AI suggest colors, mood, and thumbnail style based on your niche.</p>
                </div>
              </div>
              {aiGenerated && (
                <div className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm mb-3" style={{ background: '#ecfdf5', color: '#065f46', border: '1.5px solid #a7f3d0' }}>
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Brand identity generated from niche analysis!
                </div>
              )}
              <button
                type="button"
                onClick={() => { void generateBrandIdentity(); }}
                disabled={aiGenerating || !niche.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-2xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ border: '1.5px solid #6D4AE0', color: '#6D4AE0', background: 'white' }}
              >
                {aiGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {aiGenerating ? 'Generating…' : 'Generate Brand Identity'}
              </button>
            </div>

            {/* Brand colors */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-4">Brand Colors</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Primary', value: primaryColor, set: setPrimaryColor },
                  { label: 'Accent', value: accentColor, set: setAccentColor },
                  { label: 'Background', value: bgColor, set: setBgColor },
                ].map(({ label, value, set }) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-400 mb-1">{label}</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={value} onChange={e => set(e.target.value)} className="w-8 h-8 rounded-lg cursor-pointer" style={{ border: '1.5px solid #e3ddf8' }} />
                      <input type="text" value={value} onChange={e => set(e.target.value)} className="flex-1 rounded-xl px-2 py-1 text-xs font-mono bg-white outline-none focus:ring-2 focus:ring-[#6D4AE0]/20" style={{ border: '1.5px solid #e3e0f0' }} />
                    </div>
                  </div>
                ))}
              </div>
              {/* Preview */}
              <div className="mt-4 rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
                <div style={{ backgroundColor: bgColor }} className="p-4 flex items-center justify-center h-20 relative">
                  <span style={{ color: primaryColor, fontFamily: 'sans-serif', fontWeight: 700, fontSize: 18 }}>Your Channel Title</span>
                  <div style={{ backgroundColor: accentColor }} className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg text-white text-xs">CTA</div>
                </div>
              </div>
            </div>

            {/* Typography & Style */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-4">Visual Style</h2>
              <div className="space-y-3">
                <div>
                  <label htmlFor="brand-font-style" className="block text-xs text-gray-400 mb-1">Font Style</label>
                  <input id="brand-font-style" type="text" value={fontStyle} onChange={e => setFontStyle(e.target.value)} className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all" style={{ border: '1.5px solid #e3e0f0' }} />
                </div>
                <div>
                  <label htmlFor="brand-visual-mood" className="block text-xs text-gray-400 mb-1">Visual Mood</label>
                  <input id="brand-visual-mood" type="text" value={visualMood} onChange={e => setVisualMood(e.target.value)} placeholder="e.g. professional, clean, modern" className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all" style={{ border: '1.5px solid #e3e0f0' }} />
                </div>
                <div>
                  <label htmlFor="brand-thumbnail-style" className="block text-xs text-gray-400 mb-1">Thumbnail Style</label>
                  <input id="brand-thumbnail-style" type="text" value={thumbnailStyle} onChange={e => setThumbnailStyle(e.target.value)} placeholder="e.g. Bold text overlay, reaction shot" className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all" style={{ border: '1.5px solid #e3e0f0' }} />
                </div>
              </div>
            </div>

            {/* Voice Profile */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <div className="flex items-center gap-2 mb-1">
                <Mic className="w-4 h-4" style={{ color: '#6D4AE0' }} />
                <h2 className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">Voice Profile</h2>
              </div>
              <p className="text-xs text-gray-400 mb-4">Used by VoiceAgent to generate per-section TTS specifications</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Narrator Name', value: voiceName, set: setVoiceName, placeholder: 'e.g. Alex' },
                  { label: 'Style', value: voiceStyle, set: setVoiceStyle, placeholder: 'conversational / formal / energetic' },
                  { label: 'Tone', value: voiceTone, set: setVoiceTone, placeholder: 'engaging, confident, warm' },
                  { label: 'Pace', value: voicePace, set: setVoicePace, placeholder: 'slow / moderate / fast' },
                  { label: 'TTS Provider', value: voiceProvider, set: setVoiceProvider, placeholder: 'elevenlabs / openai / azure' },
                ].map(({ label, value, set, placeholder }) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-400 mb-1">{label}</label>
                    <input
                      type="text"
                      value={value}
                      onChange={e => set(e.target.value)}
                      placeholder={placeholder}
                      className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                      style={{ border: '1.5px solid #e3e0f0' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              onClick={save}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl font-bold text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Brand Kit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
