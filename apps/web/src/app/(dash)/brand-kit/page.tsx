'use client';
import { useState, useEffect } from 'react';
import { Palette, Mic, Save, CheckCircle, RefreshCw } from 'lucide-react';

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
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Palette className="w-7 h-7 text-brand-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brand Kit</h1>
          <p className="text-sm text-gray-500">Visual identity and voice profile used across all AI-generated assets</p>
        </div>
      </div>

      {/* Channel selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Channel</label>
        <div className="flex gap-2">
          {channels.map(ch => (
            <button
              key={ch.id}
              onClick={() => selectChannel(ch)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${selected?.id === ch.id ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
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
        <div className="space-y-6">
          {/* Niche */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Channel Niche</h2>
            <input
              type="text"
              value={niche}
              onChange={e => setNiche(e.target.value)}
              placeholder="e.g. AI, Technology, Personal Finance, Health…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Brand colors */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Brand Colors</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Primary', value: primaryColor, set: setPrimaryColor },
                { label: 'Accent', value: accentColor, set: setAccentColor },
                { label: 'Background', value: bgColor, set: setBgColor },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={value} onChange={e => set(e.target.value)} className="w-8 h-8 rounded border border-gray-200 cursor-pointer" />
                    <input type="text" value={value} onChange={e => set(e.target.value)} className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs font-mono" />
                  </div>
                </div>
              ))}
            </div>
            {/* Preview */}
            <div className="mt-4 rounded-lg overflow-hidden border border-gray-200">
              <div style={{ backgroundColor: bgColor }} className="p-4 flex items-center justify-center h-20 relative">
                <span style={{ color: primaryColor, fontFamily: 'sans-serif', fontWeight: 700, fontSize: 18 }}>Your Channel Title</span>
                <div style={{ backgroundColor: accentColor }} className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-white text-xs">CTA</div>
              </div>
            </div>
          </div>

          {/* Typography & Style */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Visual Style</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Font Style</label>
                <input type="text" value={fontStyle} onChange={e => setFontStyle(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Visual Mood</label>
                <input type="text" value={visualMood} onChange={e => setVisualMood(e.target.value)} placeholder="e.g. professional, clean, modern" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Thumbnail Style</label>
                <input type="text" value={thumbnailStyle} onChange={e => setThumbnailStyle(e.target.value)} placeholder="e.g. Bold text overlay, reaction shot" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>

          {/* Voice Profile */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><Mic className="w-4 h-4 text-brand-500" /> Voice Profile</h2>
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
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input
                    type="text"
                    value={value}
                    onChange={e => set(e.target.value)}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            onClick={save}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Brand Kit'}
          </button>
        </div>
      )}
    </div>
  );
}
