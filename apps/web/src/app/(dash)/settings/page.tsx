'use client';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Youtube, CreditCard, Loader2, CheckCircle, Link, PlusCircle,
  LogOut, RefreshCw, Trash2, AlertCircle, XCircle, X, Clock, Eye,
  Key, Save, EyeOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

interface Channel {
  id: string;
  title: string;
  thumbnailUrl?: string;
  customUrl?: string;
  subscriberCount: number;
  active: boolean;
  readOnly?: boolean;
  lastSyncedAt?: string;
}

interface Subscription {
  plan: string;
  status: string;
  currentPeriodEnd: string;
}

interface ApiKeyEntry {
  key: string;
  label: string;
  masked: string;
  set: boolean;
}

// Human-readable descriptions for OAuth error codes from the callback
const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Connection cancelled. No channel was connected.',
  no_channel: 'No YouTube channel found on that Google account.',
  invalid_grant: 'Authentication failed — the authorisation code expired. Please try connecting again.',
  redirect_mismatch: 'Redirect URI mismatch. Check your Google Cloud Console settings.',
  invalid_client: 'Invalid Google client credentials. Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.',
  missing_params: 'The OAuth callback was missing required parameters.',
  oauth_failed: 'YouTube connection failed. Please try again.',
  permission_denied: 'Permission denied. YouTube access was not granted.',
  quota_exceeded: 'YouTube API quota exceeded. Please try again later.',
};

const PLANS = [
  { id: 'STARTER', name: 'Starter', price: '$29/mo', features: ['5 videos/mo', '3 AI agents', 'Basic analytics'] },
  { id: 'PRO', name: 'Pro', price: '$79/mo', features: ['Unlimited videos', 'All 15 agents', 'Priority support', 'Analytics'] },
  { id: 'AGENCY', name: 'Agency', price: '$199/mo', features: ['Unlimited everything', 'Team seats', 'White-label', 'Dedicated support'] },
];

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api/v1';

type BannerType = 'success' | 'error' | 'warning' | 'info';

type BannerState = {
  type: BannerType;
  message: string;
};

function safeString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(safeString).join('\n');
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj['message'] === 'string') return obj['message'];
    try { return JSON.stringify(val); } catch { return 'An unexpected error occurred.'; }
  }
  return 'An unexpected error occurred.';
}

// Simple inline toast — appears at top, auto-dismisses
function Banner({
  type,
  message,
  onDismiss,
}: { type: BannerType; message: unknown; onDismiss: () => void }) {
  const text = safeString(message);
  const styles: Record<BannerType, string> = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  const icons: Record<BannerType, React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />,
    error: <XCircle className="w-4 h-4 text-red-600 shrink-0" />,
    warning: <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />,
    info: <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />,
  };
  return (
    <div className={`flex items-start gap-2 border rounded-xl px-4 py-3 text-sm ${styles[type]}`}>
      {icons[type]}
      <span className="flex-1 whitespace-pre-wrap">{text}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function SettingsContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();

  const justConnected = searchParams.get('connected') === 'true';
  const oauthErrorCode = searchParams.get('error') ?? '';

  const [banner, setBanner] = useState<BannerState | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  // Set to true after OAuth callback redirect — we wait for channels to reload before showing success
  const pendingVerification = useRef(false);

  const { data: channels = [], isLoading: chLoading } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  const { data: sub } = useQuery<Subscription>({
    queryKey: ['subscription'],
    queryFn: () => api.billing.getSubscription().then((r) => r.data as Subscription),
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me().then((r) => r.data),
  });

  const isOwner = me?.role === 'OWNER';

  const { data: apiKeys = [] } = useQuery<ApiKeyEntry[]>({
    queryKey: ['settings-api-keys'],
    queryFn: () => api.settings.getApiKeys().then((r) => r.data),
    enabled: isOwner,
  });

  // Step 1 — detect ?connected=true from OAuth callback, clean URL, trigger channel refresh
  useEffect(() => {
    if (justConnected) {
      pendingVerification.current = true;
      window.history.replaceState({}, '', '/settings');
      void qc.invalidateQueries({ queryKey: ['channels'] });
    }
  }, [justConnected, qc]);

  // Step 2 — after channels reload, verify a channel actually exists before showing success
  useEffect(() => {
    if (!pendingVerification.current || chLoading) return;
    pendingVerification.current = false;
    const active = channels.filter((c) => c.active);
    if (active.length > 0) {
      setBanner({ type: 'success', message: `YouTube channel connected successfully!` });
    } else {
      setBanner({ type: 'error', message: 'Connection could not be verified. Please try again.' });
    }
  }, [channels, chLoading]);

  // Handle ?error=... from OAuth callback
  useEffect(() => {
    if (oauthErrorCode) {
      const message = OAUTH_ERRORS[oauthErrorCode] ?? OAUTH_ERRORS['oauth_failed']!;
      setBanner({ type: 'error', message });
      window.history.replaceState({}, '', '/settings');
    }
  }, [oauthErrorCode]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      console.log('[OAuth] Button clicked — requesting auth URL');
      const redirectUri = `${API_URL}/channels/oauth/callback`;
      const { data } = await api.channels.getAuthUrl(redirectUri) as { data: { url: string } };
      console.log('[OAuth] Redirecting to Google');
      window.location.href = data.url;
    },
    onError: (err: unknown) => {
      const message = getErrorMessage(err);
      console.error('[OAuth] Failed to get auth URL —', message);
      setBanner({ type: 'error', message: `Could not start YouTube connection: ${message}` });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.channels.disconnect(id),
    onSuccess: () => {
      setConfirmDisconnect(null);
      void qc.invalidateQueries({ queryKey: ['channels'] });
      setBanner({ type: 'info', message: 'Channel disconnected. You can reconnect it at any time.' });
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Failed to disconnect channel. Please try again.' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.channels.remove(id),
    onSuccess: () => {
      setConfirmRemove(null);
      void qc.invalidateQueries({ queryKey: ['channels'] });
      setBanner({ type: 'info', message: 'Channel removed permanently.' });
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Failed to remove channel. Please try again.' });
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      console.log('[OAuth] Reconnect clicked — requesting auth URL');
      const redirectUri = `${API_URL}/channels/oauth/callback`;
      const { data } = await api.channels.getAuthUrl(redirectUri) as { data: { url: string } };
      console.log('[OAuth] Redirecting to Google for reconnect');
      window.location.href = data.url;
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Could not start reconnection. Please try again.' });
    },
  });

  const refreshTokenMutation = useMutation({
    mutationFn: (channelId: string) => api.channels.refresh(channelId),
    onSuccess: (res) => {
      const data = res.data as { expiresAt: string };
      void qc.invalidateQueries({ queryKey: ['channels'] });
      setBanner({ type: 'success', message: `Token refreshed — expires ${new Date(data.expiresAt).toLocaleString()}` });
    },
    onError: (err: unknown) => {
      setBanner({ type: 'error', message: getErrorMessage(err) || 'Failed to refresh token. Try reconnecting.' });
    },
  });

  const connectByUrlMutation = useMutation({
    mutationFn: (channelUrl: string) => api.channels.connectByUrl(channelUrl),
    onSuccess: (res) => {
      const ch = res.data as { title: string };
      setUrlInput('');
      setShowUrlForm(false);
      void qc.invalidateQueries({ queryKey: ['channels'] });
      setBanner({ type: 'success', message: `"${ch.title}" added in read-only mode. Analytics are view-only (no upload access).` });
    },
    onError: (err: unknown) => {
      setBanner({ type: 'error', message: getErrorMessage(err) || 'Could not find that YouTube channel. Check the URL and try again.' });
    },
  });

  const upgradeMutation = useMutation({
    mutationFn: (plan: string) => api.billing.createCheckout(plan),
    onSuccess: (res) => {
      const data = res.data as { url: string };
      if (data.url) window.location.href = data.url;
    },
  });

  const saveApiKeysMutation = useMutation({
    mutationFn: () => api.settings.updateApiKeys(apiKeyDrafts),
    onSuccess: () => {
      setApiKeyDrafts({});
      void qc.invalidateQueries({ queryKey: ['settings-api-keys'] });
      setBanner({ type: 'success', message: 'API keys saved successfully.' });
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Failed to save API keys.' });
    },
  });

  const activeChannels = channels.filter((c) => c.active);
  const inactiveChannels = channels.filter((c) => !c.active);

  // Any mutation touching channels is in flight
  const channelBusy =
    disconnectMutation.isPending || removeMutation.isPending ||
    reconnectMutation.isPending || refreshTokenMutation.isPending;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Global notification banner */}
      {banner && (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      )}

      {/* ── YouTube Channels ──────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Youtube className="w-5 h-5 text-red-600" />
          YouTube Channels
        </h2>


        {chLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
        ) : (
          <div className="space-y-3">
            {/* Active / connected channels */}
            {activeChannels.map((ch) => (
              <div key={ch.id} className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl p-4">
                {ch.thumbnailUrl ? (
                  <img src={ch.thumbnailUrl} alt={ch.title} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <Youtube className="w-5 h-5 text-red-600" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{ch.title}</p>
                  {ch.customUrl && (
                    <p className="text-xs text-gray-400 truncate">{ch.customUrl.startsWith('@') ? ch.customUrl : `@${ch.customUrl}`}</p>
                  )}
                  <p className="text-sm text-gray-500">{ch.subscriberCount.toLocaleString()} subscribers</p>
                  {ch.lastSyncedAt && (
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      Last sync {new Date(ch.lastSyncedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {ch.readOnly ? (
                  <span className="flex items-center gap-1 text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                    <Eye className="w-3 h-3" /> Read-only
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    <CheckCircle className="w-3 h-3" /> Connected
                  </span>
                )}

                {confirmDisconnect === ch.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Sign out?</span>
                    <button
                      onClick={() => disconnectMutation.mutate(ch.id)}
                      disabled={channelBusy}
                      className="px-3 py-1 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                    >
                      {disconnectMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                      Yes, sign out
                    </button>
                    <button
                      onClick={() => setConfirmDisconnect(null)}
                      className="px-3 py-1 border border-gray-300 text-xs rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {!ch.readOnly && (
                      <button
                        onClick={() => refreshTokenMutation.mutate(ch.id)}
                        disabled={channelBusy}
                        title="Refresh OAuth token"
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-40"
                      >
                        {refreshTokenMutation.isPending
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <RefreshCw className="w-4 h-4" />}
                        Refresh Token
                      </button>
                    )}
                    <button
                      onClick={() => setConfirmDisconnect(ch.id)}
                      disabled={channelBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Disconnected / inactive channels */}
            {inactiveChannels.map((ch) => (
              <div key={ch.id} className="flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
                {ch.thumbnailUrl ? (
                  <img src={ch.thumbnailUrl} alt={ch.title} className="w-10 h-10 rounded-full object-cover grayscale" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <Youtube className="w-5 h-5 text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-600 truncate">{ch.title}</p>
                  <p className="text-sm text-gray-400">{ch.subscriberCount.toLocaleString()} subscribers · Signed out</p>
                </div>

                {confirmRemove === ch.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Remove permanently?</span>
                    <button
                      onClick={() => removeMutation.mutate(ch.id)}
                      disabled={channelBusy}
                      className="px-3 py-1 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                    >
                      {removeMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                      Yes, remove
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="px-3 py-1 border border-gray-300 text-xs rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => reconnectMutation.mutate()}
                      disabled={channelBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-300 text-brand-700 text-sm rounded-lg hover:bg-brand-50 transition-colors disabled:opacity-50"
                    >
                      {reconnectMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <RefreshCw className="w-4 h-4" />}
                      Reconnect
                    </button>
                    <button
                      onClick={() => setConfirmRemove(ch.id)}
                      disabled={channelBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Connect / add another channel */}
            {channels.length === 0 ? (
              /* Empty state — no channels yet */
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl py-10 gap-3">
                <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                  <Youtube className="w-6 h-6 text-red-500" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-gray-700">No YouTube channel connected</p>
                  <p className="text-sm text-gray-500 mt-0.5">Connect your channel to start creating content</p>
                </div>
                <button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {connectMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Google…</>
                    : <><Link className="w-4 h-4" /> Connect with Google</>}
                </button>
                <p className="text-xs text-gray-400">— or —</p>
                <button
                  onClick={() => setShowUrlForm((v) => !v)}
                  className="text-sm text-brand-600 hover:underline"
                >
                  Add by YouTube channel URL or @handle
                </button>
              </div>
            ) : (
              /* Already have channels — offer to add another */
              <div className="flex gap-2">
                <button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 flex-1 justify-center"
                >
                  {connectMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Google…</>
                    : <><PlusCircle className="w-4 h-4" /> Add via Google Sign-in</>}
                </button>
                <button
                  onClick={() => setShowUrlForm((v) => !v)}
                  className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50 transition-colors flex-1 justify-center"
                >
                  <Link className="w-4 h-4" /> Add by URL / @handle
                </button>
              </div>
            )}

            {/* URL connection form */}
            {showUrlForm && (
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <p className="text-sm font-medium text-gray-700">Add channel by URL or @handle</p>
                <p className="text-xs text-gray-500">
                  Works without Google Sign-in. Added channels are <strong>read-only</strong> — you can view analytics but not publish videos.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && urlInput.trim()) {
                        const val = urlInput.trim();
                        const isHandle = /^@[\w.-]+$/.test(val);
                        const isChannelId = /^UC[\w-]{22}$/.test(val);
                        const isUrl = val.includes('youtube.com/');
                        if (!isHandle && !isChannelId && !isUrl) {
                          setBanner({ type: 'error', message: 'Enter a YouTube channel URL (youtube.com/@name), a @handle, or a channel ID starting with UC.' });
                          return;
                        }
                        connectByUrlMutation.mutate(val);
                      }
                    }}
                    placeholder="https://youtube.com/@channelname or @channelname"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  />
                  <button
                    onClick={() => {
                      const val = urlInput.trim();
                      if (!val) return;
                      const isHandle = /^@[\w.-]+$/.test(val);
                      const isChannelId = /^UC[\w-]{22}$/.test(val);
                      const isUrl = val.includes('youtube.com/');
                      if (!isHandle && !isChannelId && !isUrl) {
                        setBanner({ type: 'error', message: 'Enter a YouTube channel URL (youtube.com/@name), a @handle, or a channel ID starting with UC.' });
                        return;
                      }
                      connectByUrlMutation.mutate(val);
                    }}
                    disabled={!urlInput.trim() || connectByUrlMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {connectByUrlMutation.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Link className="w-4 h-4" />}
                    Add
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Examples: <code>https://youtube.com/@MrBeast</code> · <code>@mkbhd</code> · <code>UCxxxxxx</code>
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── API Keys (Owner only) ─────────────────────────── */}
      {isOwner && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <Key className="w-5 h-5 text-brand-600" />
            API Keys
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Configure provider API keys used by the AI agents. Visible to owner only.
          </p>

          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {apiKeys.map((entry) => {
              const draft = apiKeyDrafts[entry.key];
              const displayValue = draft !== undefined ? draft : '';
              const isVisible = showKeys[entry.key] ?? false;

              return (
                <div key={entry.key} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{entry.label}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">
                      {entry.key}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 w-80">
                    <div className="relative flex-1">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        value={displayValue}
                        placeholder={entry.set ? entry.masked : 'Not set — paste key here'}
                        onChange={(e) =>
                          setApiKeyDrafts((prev) => ({ ...prev, [entry.key]: e.target.value }))
                        }
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono pr-8 bg-white placeholder:text-gray-400 placeholder:font-sans"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeys((p) => ({ ...p, [entry.key]: !isVisible }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {entry.set && draft === undefined && (
                      <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 whitespace-nowrap">
                        <CheckCircle className="w-3 h-3" /> Set
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {Object.keys(apiKeyDrafts).length > 0 && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => saveApiKeysMutation.mutate()}
                disabled={saveApiKeysMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
              >
                {saveApiKeysMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : <><Save className="w-4 h-4" /> Save API Keys</>}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Billing ───────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-600" />
          Billing
        </h2>
        {sub && (
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 mb-4">
            <p className="font-medium text-brand-900">Current plan: {sub.plan}</p>
            <p className="text-sm text-brand-700">Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div key={plan.id} className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="font-semibold text-gray-900">{plan.name}</h3>
              <p className="text-2xl font-bold text-brand-600 my-2">{plan.price}</p>
              <ul className="space-y-1 mb-4">
                {plan.features.map((f) => (
                  <li key={f} className="text-sm text-gray-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-500" /> {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => upgradeMutation.mutate(plan.id)}
                disabled={upgradeMutation.isPending || sub?.plan === plan.id}
                className="w-full px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {sub?.plan === plan.id ? 'Current' : 'Upgrade'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
