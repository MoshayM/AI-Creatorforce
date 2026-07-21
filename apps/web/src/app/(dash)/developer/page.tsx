'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Code2, Copy, Check, Plus, Trash2, X, ChevronDown, ChevronUp, Loader2, BarChart2, Key } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface ApiKey {
  id: string;
  name: string;
  description?: string;
  keyPrefix?: string;
  maskedKey?: string;
  scopes?: string[];
  lastUsedAt?: string | null;
  createdAt: string;
  requestCount?: number;
  key?: string;
}

interface DailyCount {
  date: string;
  count: number;
}

interface UsageData {
  keys: Array<{ keyId: string; name: string; total: number; daily?: DailyCount[] }>;
  total: number;
}

const ALL_SCOPES = [
  'read:projects',
  'write:jobs',
  'read:analytics',
  'manage:channels',
  'webhooks',
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DeveloperPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'keys' | 'usage'>('keys');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageDays, setUsageDays] = useState(30);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyDesc, setNewKeyDesc] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['read:projects']);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedMasked, setCopiedMasked] = useState<string | null>(null);

  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const [error, setError] = useState('');

  // Restrict to OWNER / SUPER_ADMIN — redirect others back to home
  useEffect(() => {
    try {
      const token = localStorage.getItem('cf_token');
      if (!token) { router.replace('/home'); return; }
      const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { role?: string };
      if (!['OWNER', 'SUPER_ADMIN'].includes(payload.role ?? '')) {
        router.replace('/home');
      }
    } catch {
      router.replace('/home');
    }
  }, [router]);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    setError('');
    try {
      const res = await apiClient.get<ApiKey[]>('/dev/keys');
      setKeys(res.data ?? []);
    } catch {
      setError('Failed to load API keys.');
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async (days: number) => {
    setUsageLoading(true);
    setUsageError(false);
    try {
      const res = await apiClient.get<UsageData>(`/dev/usage?days=${days}`);
      setUsage(res.data);
    } catch {
      setUsage(null);
      setUsageError(true);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => { void loadKeys(); }, [loadKeys]);
  useEffect(() => {
    if (tab === 'usage') void loadUsage(usageDays);
  }, [tab, usageDays, loadUsage]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await apiClient.post<ApiKey>('/dev/keys', {
        name: newKeyName.trim(),
        description: newKeyDesc.trim() || undefined,
        scopes: newKeyScopes,
      });
      if (res.data.key) setCreatedKey(res.data.key);
      setNewKeyName('');
      setNewKeyDesc('');
      setNewKeyScopes(['read:projects']);
      setShowCreate(false);
      void loadKeys();
    } catch {
      setCreateError('Failed to create key. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await apiClient.delete(`/dev/keys/${id}`);
      setKeys(prev => prev.filter(k => k.id !== id));
      setRevokeConfirm(null);
    } catch {
      setError('Failed to revoke key.');
    } finally {
      setRevoking(null);
    }
  }

  function toggleScope(scope: string) {
    setNewKeyScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  }

  async function copyText(text: string, type: 'key' | string) {
    await navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedMasked(type);
      setTimeout(() => setCopiedMasked(null), 2000);
    }
  }

  const maxUsage = usage ? Math.max(...usage.keys.map(k => k.total), 1) : 1;

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-4xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
          >
            <Code2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Developer Portal</h1>
            <p className="text-sm text-gray-400 mt-0.5">Build integrations with your AI content pipeline</p>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 text-sm">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')}><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* New key success banner */}
        {createdKey && (
          <div
            className="rounded-2xl p-5"
            style={{ background: '#f5f2fd', border: '1.5px solid #c4b5fd' }}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-semibold" style={{ color: '#6D4AE0' }}>Key created! Copy it now — it won&apos;t be shown again.</p>
                <p className="text-xs mt-0.5" style={{ color: '#7c5ae8' }}>Store this key securely. We cannot recover it.</p>
              </div>
              <button
                type="button"
                onClick={() => setCreatedKey(null)}
                className="ml-4"
                style={{ color: '#a78bfa' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="font-mono text-sm bg-gray-900 text-green-400 p-3 rounded-xl break-all mb-3">
              {createdKey}
            </div>
            <button
              type="button"
              onClick={() => void copyText(createdKey, 'key')}
              className="flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
            >
              {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedKey ? 'Copied!' : 'Copy Key'}
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex bg-gray-100 rounded-2xl p-1 w-fit">
          {(['keys', 'usage'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-medium rounded-2xl transition-colors capitalize ${tab === t ? 'bg-white shadow' : 'text-gray-500 hover:text-gray-700'}`}
              style={tab === t ? { color: '#6D4AE0' } : undefined}
            >
              {t === 'keys'
                ? <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /> API Keys</span>
                : <span className="flex items-center gap-1.5"><BarChart2 className="w-3.5 h-3.5" /> Usage</span>
              }
            </button>
          ))}
        </div>

        {/* ── API Keys tab ── */}
        {tab === 'keys' && (
          <div className="space-y-4">
            {/* Create form toggle */}
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
              <button
                type="button"
                onClick={() => setShowCreate(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" style={{ color: '#6D4AE0' }} /> Create New API Key
                </span>
                {showCreate
                  ? <ChevronUp className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />
                }
              </button>

              {showCreate && (
                <form onSubmit={(e) => { void handleCreate(e); }} className="px-5 py-4 space-y-4" style={{ borderTop: '1.5px solid #e3ddf8' }}>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={e => setNewKeyName(e.target.value)}
                      placeholder="e.g. Production Integration"
                      className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                      style={{ border: '1.5px solid #e3e0f0' }}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                    <input
                      type="text"
                      value={newKeyDesc}
                      onChange={e => setNewKeyDesc(e.target.value)}
                      placeholder="Optional description"
                      className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                      style={{ border: '1.5px solid #e3e0f0' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Scopes</label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_SCOPES.map(scope => (
                        <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newKeyScopes.includes(scope)}
                            onChange={() => toggleScope(scope)}
                            className="rounded border-gray-300 focus:ring-[#6D4AE0]"
                            style={{ accentColor: '#6D4AE0' }}
                          />
                          <span className="text-xs text-gray-700">{scope}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {createError && <p className="text-red-500 text-xs">{createError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={creating || !newKeyName.trim()}
                      className="flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
                    >
                      {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {creating ? 'Creating…' : 'Create API Key'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="px-4 py-2 rounded-2xl text-sm text-gray-600 hover:bg-gray-50"
                      style={{ border: '1.5px solid #e3ddf8' }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Keys list */}
            {keysLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : keys.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center" style={{ border: '1.5px solid #e3ddf8' }}>
                <Key className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 text-sm">No API keys yet. Create one above to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {keys.map(key => (
                  <div key={key.id} className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-semibold text-gray-900 text-sm">{key.name}</h3>
                          {key.requestCount != null && key.requestCount > 0 && (
                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{key.requestCount.toLocaleString()} reqs</span>
                          )}
                        </div>
                        {key.description && <p className="text-xs text-gray-500 mb-2">{key.description}</p>}

                        {/* Masked key */}
                        {(key.maskedKey ?? key.keyPrefix) && (
                          <div className="flex items-center gap-2 mb-3">
                            <code className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-lg font-mono">
                              {key.maskedKey ?? `${key.keyPrefix}...`}
                            </code>
                            <button
                              type="button"
                              onClick={() => void copyText(key.maskedKey ?? key.keyPrefix ?? '', key.id)}
                              className="text-gray-400 hover:text-gray-600"
                              title="Copy prefix"
                            >
                              {copiedMasked === key.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        )}

                        {/* Scopes */}
                        {(key.scopes ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {(key.scopes ?? []).map(s => (
                              <span key={s} className="px-2 py-0.5 bg-[#f5f2fd] text-[#6D4AE0] rounded-full text-xs">{s}</span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span>Created {formatDate(key.createdAt)}</span>
                          <span>Last used: {key.lastUsedAt ? timeAgo(key.lastUsedAt) : 'Never'}</span>
                        </div>
                      </div>

                      {/* Revoke */}
                      <div className="shrink-0">
                        {revokeConfirm === key.id ? (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-600 text-xs whitespace-nowrap">Revoke?</span>
                            <button
                              type="button"
                              onClick={() => void handleRevoke(key.id)}
                              disabled={revoking === key.id}
                              className="px-2.5 py-1 bg-red-500 text-white rounded-xl text-xs font-medium hover:bg-red-600 disabled:opacity-50 flex items-center gap-1"
                            >
                              {revoking === key.id && <Loader2 className="w-3 h-3 animate-spin" />}
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setRevokeConfirm(null)}
                              className="px-2.5 py-1 rounded-xl text-xs text-gray-600 hover:bg-gray-50"
                              style={{ border: '1.5px solid #e3ddf8' }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRevokeConfirm(key.id)}
                            className="flex items-center gap-1 text-red-500 hover:text-red-700 text-sm"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Webhooks link */}
            <div className="bg-white rounded-2xl px-4 py-3 text-sm text-gray-600" style={{ border: '1.5px solid #e3ddf8' }}>
              Manage webhooks in{' '}
              <a href="/settings" className="font-medium hover:underline" style={{ color: '#6D4AE0' }}>Settings → Developer Webhooks</a>.
            </div>
          </div>
        )}

        {/* ── Usage tab ── */}
        {tab === 'usage' && (
          <div className="space-y-4">
            {/* Days selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Period:</span>
              {([7, 14, 30, 90] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setUsageDays(d)}
                  className={`px-3 py-1.5 rounded-2xl text-sm font-medium transition-colors ${usageDays === d ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                  style={usageDays === d
                    ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }
                    : { border: '1.5px solid #e3ddf8' }
                  }
                >
                  {d}d
                </button>
              ))}
            </div>

            {usageLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : usageError ? (
              <div className="bg-white rounded-2xl p-8 text-center" style={{ border: '1.5px solid #e3ddf8' }}>
                <BarChart2 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-700 text-sm font-medium mb-1">Failed to load usage data</p>
                <p className="text-gray-400 text-xs mb-4">The API may be unavailable. Check that the server is running.</p>
                <button
                  type="button"
                  onClick={() => void loadUsage(usageDays)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium text-white"
                  style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
                >
                  <Loader2 className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            ) : !usage ? (
              <div className="bg-white rounded-2xl p-8 text-center" style={{ border: '1.5px solid #e3ddf8' }}>
                <BarChart2 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 text-sm">No usage data yet. Make API calls using your keys to see stats here.</p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                    <p className="text-xs text-gray-500 mb-1">Total API Calls ({usageDays}d)</p>
                    <p className="text-2xl font-bold text-gray-900">{usage.total.toLocaleString()}</p>
                  </div>
                  <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                    <p className="text-xs text-gray-500 mb-1">Active Keys</p>
                    <p className="text-2xl font-bold text-gray-900">{usage.keys.filter(k => k.total > 0).length}</p>
                  </div>
                </div>

                {/* Per-key bars */}
                {usage.keys.length > 0 && (
                  <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                    <h2 className="font-semibold text-gray-900 mb-4 text-sm">Usage by Key</h2>
                    <div className="space-y-3">
                      {usage.keys.sort((a, b) => b.total - a.total).map(k => (
                        <div key={k.keyId}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-gray-700 truncate flex-1 mr-3">{k.name}</span>
                            <span className="text-sm font-medium text-gray-900 shrink-0">{k.total.toLocaleString()}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${Math.max(2, (k.total / maxUsage) * 100)}%`,
                                background: 'linear-gradient(90deg, #6D4AE0, #9d6ff0)',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
