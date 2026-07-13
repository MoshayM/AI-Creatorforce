'use client';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Youtube, CreditCard, Loader2, CheckCircle, Link as LinkIcon2, PlusCircle,
  LogOut, RefreshCw, Trash2, AlertCircle, XCircle, X, Clock, Eye,
  Key, Save, EyeOff, Shield, Monitor, Unlink, Link2,
} from 'lucide-react';
import { api, type OAuthProvider, type AuthSession, type LinkedAccount, type OAuthProviders, type AuthLinksResponse } from '@/lib/api';
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
  scopes?: string[];
  accessLevel?: 'READ_ONLY' | 'PUBLISH' | 'FULL' | 'NONE';
}

type AccessLevel = 'READ_ONLY' | 'PUBLISH' | 'FULL';

// What each access level lets the app do — the creator picks (and can change)
// this themselves; every change goes back through Google's consent screen.
const ACCESS_META: Record<AccessLevel, { label: string; badge: string; permissions: string[] }> = {
  READ_ONLY: {
    label: 'Read-only',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    permissions: ['Read channel & video data for analysis'],
  },
  PUBLISH: {
    label: 'Publish',
    badge: 'bg-green-50 text-green-700 border-green-200',
    permissions: ['Read channel & video data for analysis', 'Upload videos (after your approval)'],
  },
  FULL: {
    label: 'Full Access',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    permissions: [
      'Read channel & video data for analysis',
      'Upload videos (after your approval)',
      'Manage videos, thumbnails, captions & playlists',
      'Read YouTube Analytics (retention, revenue signals)',
    ],
  },
};

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
  const justLinkedProvider = searchParams.get('linked') ?? '';

  const [banner, setBanner] = useState<BannerState | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  // Access level for new Google connections; per-channel changes use changeAccessMutation
  const [connectAccess, setConnectAccess] = useState<AccessLevel>('PUBLISH');
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessLevel>>({});
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

  const { data: walletBalance } = useQuery<{
    balanceCredits: number;
    buckets: { trialCredits: number; promotionalCredits: number; bonusCredits: number; referralCredits: number; purchasedCredits: number };
    lifetimeUsed: number;
  }>({
    queryKey: ['wallet-balance'],
    queryFn: () => api.wallet.balance().then((r) => r.data),
  });
  const [rechargeUsd, setRechargeUsd] = useState(10);
  const rechargeMutation = useMutation({
    mutationFn: (amountUsd: number) => api.wallet.recharge(amountUsd),
    onSuccess: (res) => {
      const data = res.data as { checkoutUrl: string | null };
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    },
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me().then((r) => r.data),
  });

  const isOwner = me?.role === 'OWNER' || me?.role === 'SUPER_ADMIN';

  // ── Sign-in & security queries ──────────────────────────────────────────────

  const { data: authLinks, refetch: refetchLinks } = useQuery<AuthLinksResponse>({
    queryKey: ['auth-links'],
    queryFn: () => api.auth.links().then((r) => r.data),
  });

  const { data: oauthProviders } = useQuery<OAuthProviders>({
    queryKey: ['oauth-providers'],
    queryFn: () => api.auth.providers().then((r) => r.data),
  });

  const { data: sessions = [], refetch: refetchSessions } = useQuery<AuthSession[]>({
    queryKey: ['auth-sessions'],
    queryFn: () => api.auth.sessions().then((r) => r.data),
  });

  const [confirmRevokeSession, setConfirmRevokeSession] = useState<string | null>(null);

  const revokeSessionMutation = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: (_data, id) => {
      setConfirmRevokeSession(null);
      // If the revoked session was current, clear tokens and redirect
      const wasCurrentSession = sessions.find((s) => s.id === id && s.current);
      if (wasCurrentSession) {
        localStorage.removeItem('cf_token');
        localStorage.removeItem('cf.refreshToken');
        window.location.href = '/login';
        return;
      }
      void refetchSessions();
      setBanner({ type: 'info', message: 'Session revoked.' });
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Failed to revoke session. Please try again.' });
    },
  });

  const revokeAllOtherSessionsMutation = useMutation({
    mutationFn: async () => {
      const others = sessions.filter((s) => !s.current);
      await Promise.all(others.map((s) => api.auth.revokeSession(s.id)));
    },
    onSuccess: () => {
      void refetchSessions();
      setBanner({ type: 'success', message: 'All other sessions signed out.' });
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Failed to revoke some sessions. Please try again.' });
    },
  });

  const unlinkProviderMutation = useMutation({
    mutationFn: (provider: OAuthProvider) => api.auth.unlinkProvider(provider),
    onSuccess: () => {
      void refetchLinks();
      setBanner({ type: 'success', message: 'Account disconnected.' });
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setBanner({ type: 'error', message: 'Add a password or another sign-in method before removing this one.' });
      } else {
        setBanner({ type: 'error', message: 'Failed to disconnect account.' });
      }
    },
  });

  const linkProviderMutation = useMutation({
    mutationFn: async (provider: OAuthProvider) => {
      const redirectUri = `${window.location.origin}/oauth/callback/${provider}`;
      const { data } = await api.auth.oauthStart(provider, redirectUri, 'link');
      sessionStorage.setItem('cf.oauth.state', data.state);
      window.location.href = data.authUrl;
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Could not start account linking. Please try again.' });
    },
  });

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

  // Handle ?linked=<provider> from OAuth link callback
  useEffect(() => {
    if (justLinkedProvider) {
      const label = justLinkedProvider.charAt(0).toUpperCase() + justLinkedProvider.slice(1);
      setBanner({ type: 'success', message: `${label} account linked successfully.` });
      window.history.replaceState({}, '', '/settings');
      void refetchLinks();
    }
  }, [justLinkedProvider]);

  const connectMutation = useMutation({
    mutationFn: async (access: AccessLevel) => {
      console.log('[OAuth] Button clicked — requesting auth URL');
      const redirectUri = `${API_URL}/channels/oauth/callback`;
      const { data } = await api.channels.getAuthUrl(redirectUri, access) as { data: { url: string } };
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
    mutationFn: async (access: AccessLevel = 'PUBLISH') => {
      console.log('[OAuth] Reconnect clicked — requesting auth URL');
      const redirectUri = `${API_URL}/channels/oauth/callback`;
      const { data } = await api.channels.getAuthUrl(redirectUri, access) as { data: { url: string } };
      console.log('[OAuth] Redirecting to Google for reconnect');
      window.location.href = data.url;
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Could not start reconnection. Please try again.' });
    },
  });

  // Changing access = a fresh Google consent round with the chosen scopes;
  // the callback upserts the channel with whatever the user actually grants.
  const changeAccessMutation = useMutation({
    mutationFn: async (access: AccessLevel) => {
      const redirectUri = `${API_URL}/channels/oauth/callback`;
      const { data } = await api.channels.getAuthUrl(redirectUri, access) as { data: { url: string } };
      window.location.href = data.url;
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Could not start the access change. Please try again.' });
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
              <div key={ch.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-4">
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
                    <p className="text-xs text-gray-500 truncate">{ch.customUrl.startsWith('@') ? ch.customUrl : `@${ch.customUrl}`}</p>
                  )}
                  <p className="text-sm text-gray-500">{ch.subscriberCount.toLocaleString()} subscribers</p>
                  {ch.lastSyncedAt && (
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
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
                  <span className={`flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 ${ACCESS_META[(ch.accessLevel && ch.accessLevel !== 'NONE' ? ch.accessLevel : 'PUBLISH') as AccessLevel].badge}`}>
                    <CheckCircle className="w-3 h-3" />
                    {ACCESS_META[(ch.accessLevel && ch.accessLevel !== 'NONE' ? ch.accessLevel : 'PUBLISH') as AccessLevel].label}
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

              {/* Self-service access management — every connected channel shows
                  exactly what the app may do; changing (or upgrading a URL-
                  connected channel) always goes through Google's consent screen */}
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-start justify-between gap-4 flex-wrap">
                <ul className="space-y-0.5">
                  {ch.readOnly ? (
                    <>
                      <li className="text-xs text-gray-500 flex items-center gap-1.5">
                        <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                        Read public channel data only (connected by URL, no Google sign-in)
                      </li>
                      <li className="text-xs text-gray-500 flex items-center gap-1.5">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        Choose a level and sign in with Google to unlock analysis, uploads or full management
                      </li>
                    </>
                  ) : (
                    ACCESS_META[(ch.accessLevel && ch.accessLevel !== 'NONE' ? ch.accessLevel : 'PUBLISH') as AccessLevel].permissions.map((p) => (
                      <li key={p} className="text-xs text-gray-500 flex items-center gap-1.5">
                        <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                        {p}
                      </li>
                    ))
                  )}
                </ul>
                <div className="flex items-center gap-2">
                  <select
                    value={accessDrafts[ch.id] ?? (!ch.readOnly && ch.accessLevel && ch.accessLevel !== 'NONE' ? ch.accessLevel : 'PUBLISH')}
                    onChange={(e) => setAccessDrafts((prev) => ({ ...prev, [ch.id]: e.target.value as AccessLevel }))}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-700"
                    aria-label="Channel access level"
                  >
                    <option value="READ_ONLY">Read-only</option>
                    <option value="PUBLISH">Publish</option>
                    <option value="FULL">Full Access</option>
                  </select>
                  <button
                    onClick={() => changeAccessMutation.mutate(accessDrafts[ch.id] ?? 'PUBLISH')}
                    disabled={channelBusy || (!ch.readOnly && (!accessDrafts[ch.id] || accessDrafts[ch.id] === ch.accessLevel))}
                    title={ch.readOnly ? 'Sign in with Google to grant the selected access level' : 'Re-authorize with the selected access level via Google'}
                    className="px-3 py-1.5 text-xs font-medium border border-brand-300 text-brand-700 rounded-lg hover:bg-brand-50 disabled:opacity-40 transition-colors"
                  >
                    {changeAccessMutation.isPending ? 'Redirecting…' : ch.readOnly ? 'Upgrade access' : 'Change access'}
                  </button>
                </div>
              </div>
              </div>
            ))}

            {/* Disconnected / inactive channels */}
            {inactiveChannels.map((ch) => (
              <div key={ch.id} className="flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-xl p-4">
                {ch.thumbnailUrl ? (
                  <img src={ch.thumbnailUrl} alt={ch.title} className="w-10 h-10 rounded-full object-cover grayscale" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <Youtube className="w-5 h-5 text-gray-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-600 truncate">{ch.title}</p>
                  <p className="text-sm text-gray-500">{ch.subscriberCount.toLocaleString()} subscribers · Signed out</p>
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
                      onClick={() => reconnectMutation.mutate(ch.accessLevel === 'FULL' || ch.accessLevel === 'READ_ONLY' ? ch.accessLevel : 'PUBLISH')}
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
                <div className="flex items-center gap-2">
                  <select
                    value={connectAccess}
                    onChange={(e) => setConnectAccess(e.target.value as AccessLevel)}
                    className="border border-gray-300 rounded-lg px-2 py-2.5 text-sm text-gray-700"
                    aria-label="Access level to request"
                  >
                    <option value="READ_ONLY">Read-only</option>
                    <option value="PUBLISH">Publish</option>
                    <option value="FULL">Full Access</option>
                  </select>
                  <button
                    onClick={() => connectMutation.mutate(connectAccess)}
                    disabled={connectMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {connectMutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Google…</>
                      : <><LinkIcon2 className="w-4 h-4" /> Connect with Google</>}
                  </button>
                </div>
                <p className="text-xs text-gray-500 max-w-sm text-center">
                  You choose how much access to grant and can change it anytime. Publishing always requires your approval.
                </p>
                <p className="text-xs text-gray-500">— or —</p>
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
                <select
                  value={connectAccess}
                  onChange={(e) => setConnectAccess(e.target.value as AccessLevel)}
                  className="border border-dashed border-gray-300 rounded-xl px-2 py-2.5 text-sm text-gray-600"
                  aria-label="Access level to request"
                >
                  <option value="READ_ONLY">Read-only</option>
                  <option value="PUBLISH">Publish</option>
                  <option value="FULL">Full Access</option>
                </select>
                <button
                  onClick={() => connectMutation.mutate(connectAccess)}
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
                  <LinkIcon2 className="w-4 h-4" /> Add by URL / @handle
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
                      : <LinkIcon2 className="w-4 h-4" />}
                    Add
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Examples: <code>https://youtube.com/@MrBeast</code> · <code>@mkbhd</code> · <code>UCxxxxxx</code>
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Sign-in & security ───────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-brand-600" />
          Sign-in &amp; Security
        </h2>

        {/* Linked accounts */}
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 mb-4">
          <div className="px-4 py-3">
            <p className="text-sm font-medium text-gray-800">Linked accounts</p>
            <p className="text-xs text-gray-500 mt-0.5">Connect social accounts to sign in without a password.</p>
          </div>
          {(['google', 'apple', 'facebook'] as OAuthProvider[]).map((provider) => {
            const label = provider.charAt(0).toUpperCase() + provider.slice(1);
            const linkedAccount: LinkedAccount | undefined = authLinks?.links.find((l) => l.provider === provider);
            const providerEnabled = oauthProviders?.[provider] ?? false;
            const isPending = unlinkProviderMutation.isPending || linkProviderMutation.isPending;

            return (
              <div key={provider} className="flex items-center gap-4 px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  {provider === 'google' && (
                    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
                      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z" />
                      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.1 0-5.8-2.1-6.8-5H1.3v3C3.3 21.3 7.3 24 12 24z" />
                      <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4v-3H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z" />
                      <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C16.9 1 14.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c1-2.9 3.7-4.9 6.8-4.9z" />
                    </svg>
                  )}
                  {provider === 'apple' && (
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-gray-900" aria-hidden>
                      <path d="M16.4 12.9c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.7c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-3.7zM14 5.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
                    </svg>
                  )}
                  {provider === 'facebook' && (
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#1877F2]" aria-hidden>
                      <path d="M24 12c0-6.6-5.4-12-12-12S0 5.4 0 12c0 6 4.4 11 10.1 11.9v-8.4H7.1V12h3v-2.6c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4C19.6 23 24 18 24 12z" />
                    </svg>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{label}</p>
                  {linkedAccount ? (
                    <p className="text-xs text-gray-500 truncate">{linkedAccount.email}</p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {providerEnabled ? 'Not connected' : 'Not configured'}
                    </p>
                  )}
                </div>

                {linkedAccount ? (
                  <button
                    onClick={() => unlinkProviderMutation.mutate(provider)}
                    disabled={isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-xs rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    {unlinkProviderMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                    Disconnect
                  </button>
                ) : providerEnabled ? (
                  <button
                    onClick={() => linkProviderMutation.mutate(provider)}
                    disabled={isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-300 text-brand-700 text-xs rounded-lg hover:bg-brand-50 transition-colors disabled:opacity-40"
                  >
                    {linkProviderMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                    Connect
                  </button>
                ) : (
                  <span className="text-xs text-gray-500 italic">Not configured</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Active sessions */}
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-gray-500" />
                Active sessions
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Devices currently signed in to your account.</p>
            </div>
            {sessions.filter((s) => !s.current).length > 0 && (
              <button
                onClick={() => revokeAllOtherSessionsMutation.mutate()}
                disabled={revokeAllOtherSessionsMutation.isPending}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-xs rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
              >
                {revokeAllOtherSessionsMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <LogOut className="w-3 h-3" />}
                Sign out all other sessions
              </button>
            )}
          </div>

          {sessions.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">No active sessions found.</div>
          )}

          {sessions.map((session) => {
            const deviceLabel = session.device.length > 60
              ? session.device.slice(0, 57) + '…'
              : session.device;
            const isConfirming = confirmRevokeSession === session.id;

            return (
              <div key={session.id} className="flex items-start gap-3 px-4 py-3">
                <Monitor className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-gray-700 truncate">{deviceLabel}</p>
                    {session.current && (
                      <span className="text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200 rounded-full px-2 py-0.5 whitespace-nowrap">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {session.ip} &middot; Last active {new Date(session.lastUsedAt).toLocaleString()}
                  </p>
                </div>

                {isConfirming ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-500">
                      {session.current ? 'You will be signed out.' : 'Revoke?'}
                    </span>
                    <button
                      onClick={() => revokeSessionMutation.mutate(session.id)}
                      disabled={revokeSessionMutation.isPending}
                      className="px-3 py-1 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                    >
                      {revokeSessionMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                      Yes, revoke
                    </button>
                    <button
                      onClick={() => setConfirmRevokeSession(null)}
                      className="px-3 py-1 border border-gray-300 text-xs rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRevokeSession(session.id)}
                    disabled={revokeSessionMutation.isPending}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs rounded-lg hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    <XCircle className="w-3 h-3" />
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </div>
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
                    <p className="text-xs text-gray-500 font-mono mt-0.5">
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
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono pr-8 bg-white placeholder:text-gray-500 placeholder:font-sans"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeys((p) => ({ ...p, [entry.key]: !isVisible }))}
                        aria-label={isVisible ? 'Hide key' : 'Show key'}
                        className="absolute right-0.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-600"
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

        {/* Wallet (credits are platform-agnostic; recharge via Stripe on web) */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs text-gray-500">Credit balance</p>
            <p className="text-2xl font-bold text-gray-900">{(walletBalance?.balanceCredits ?? 0).toLocaleString()}</p>
            {walletBalance && walletBalance.balanceCredits > 0 && (
              <p className="text-[11px] text-gray-500 mt-0.5">
                {walletBalance.buckets.purchasedCredits.toLocaleString()} purchased
                {(walletBalance.buckets.trialCredits ?? 0) > 0 && <> · {walletBalance.buckets.trialCredits.toLocaleString()} trial</>}
                {walletBalance.buckets.bonusCredits > 0 && <> · {walletBalance.buckets.bonusCredits.toLocaleString()} bonus</>}
                {walletBalance.buckets.promotionalCredits > 0 && <> · {walletBalance.buckets.promotionalCredits.toLocaleString()} promo</>}
                {walletBalance.buckets.referralCredits > 0 && <> · {walletBalance.buckets.referralCredits.toLocaleString()} referral</>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Recharge amount"
              value={rechargeUsd}
              onChange={(e) => setRechargeUsd(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white"
            >
              {[5, 10, 25, 50, 100].map((usd) => (
                <option key={usd} value={usd}>${usd}</option>
              ))}
            </select>
            <button
              onClick={() => rechargeMutation.mutate(rechargeUsd)}
              disabled={rechargeMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {rechargeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
              Add credits
            </button>
          </div>
          {rechargeMutation.isError && (
            <p className="w-full text-xs text-red-500">{getErrorMessage(rechargeMutation.error) || 'Recharge failed'}</p>
          )}
          <div className="w-full text-right">
            <Link href="/wallet" className="text-xs text-brand-600 hover:underline">
              Open full wallet →
            </Link>
          </div>
        </div>
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
