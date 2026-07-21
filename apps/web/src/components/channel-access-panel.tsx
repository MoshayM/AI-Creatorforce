'use client';
import { type ComponentType, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Youtube, Loader2, CheckCircle, Link as LinkIcon2, PlusCircle,
  LogOut, RefreshCw, Trash2, AlertCircle, Clock, Eye,
  Facebook, Instagram, Music2, Share2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';
import { Banner, type BannerState } from '@/components/banner';

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

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api/v1';

// Inline SVG icons for platforms not in Lucide
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const LinkedInIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.35-1.85 3.58 0 4.24 2.36 4.24 5.43v6.31zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/>
  </svg>
);

const ThreadsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 192 192" className={className} fill="currentColor" aria-hidden>
    <path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.34c-14.986 0-27.449 6.396-35.12 18.036l13.779 9.452c5.73-8.695 14.724-10.548 21.348-10.548h.229c8.249.053 14.474 2.452 18.503 7.129 2.932 3.405 4.893 8.111 5.864 14.05-7.314-1.243-15.224-1.626-23.68-1.14-23.82 1.371-39.134 15.264-38.105 34.568.522 9.792 5.4 18.216 13.735 23.719 7.047 4.652 16.124 6.927 25.557 6.412 12.458-.683 22.231-5.436 29.049-14.127 5.178-6.6 8.453-15.153 9.899-25.93 5.937 3.583 10.337 8.298 12.767 13.966 4.132 9.635 4.373 25.468-8.546 38.376-11.319 11.308-24.925 16.2-45.488 16.351-22.739-.169-39.934-7.451-51.093-21.641C35.942 138.355 30.5 120.512 30.5 96c0-24.512 5.442-42.355 16.171-53.017C57.83 29.621 75.025 22.34 97.764 22.17c22.987.17 40.462 7.479 51.956 21.732 5.603 6.99 9.976 15.73 13.067 26.003l16.212-4.476c-3.769-12.988-9.331-24.052-16.663-33.052C147.036 13.726 125.202 4.203 97.93 4h-.404C70.28 4.203 48.66 13.765 33.816 32.01 20.695 48.343 13.987 71.76 13.8 96.1c.187 24.34 6.895 47.757 20.016 64.09C48.66 178.436 70.28 187.997 97.526 188.2h.404c24.268-.17 41.337-6.52 55.4-20.572 18.456-18.442 17.908-41.447 11.815-55.627-4.353-10.147-12.645-18.342-23.608-23.013zM96.952 153.658c-10.437.576-21.286-2.657-28.87-7.701-5.924-3.909-9.14-9.424-9.397-15.836-.41-10.148 7.23-19.835 27.063-21.01 2.341-.135 4.638-.2 6.888-.2 7.032 0 13.602.68 19.594 2.011-2.219 27.579-6.615 42.03-15.278 42.736z"/>
  </svg>
);

// Social platforms that will join YouTube in this panel — publishing and
// tracking integrations for these are on the roadmap.
const SOCIAL_PLATFORMS: Array<{
  key: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  tile: string;
  color: string;
  note: string;
}> = [
  { key: 'facebook',  name: 'Facebook',   icon: Facebook,     tile: 'bg-blue-50',       color: 'text-blue-600',  note: 'Pages & Reels publishing' },
  { key: 'instagram', name: 'Instagram',  icon: Instagram,    tile: 'bg-pink-50',        color: 'text-pink-600',  note: 'Reels & Stories publishing' },
  { key: 'tiktok',    name: 'TikTok',     icon: Music2,       tile: 'bg-gray-100',       color: 'text-gray-900',  note: 'Video publishing & analytics' },
  { key: 'x',         name: 'X (Twitter)',icon: XIcon,        tile: 'bg-black',          color: 'text-white',     note: 'Post & thread publishing' },
  { key: 'linkedin',  name: 'LinkedIn',   icon: LinkedInIcon, tile: 'bg-[#0A66C2]',      color: 'text-white',     note: 'Article & video publishing' },
  { key: 'threads',   name: 'Threads',    icon: ThreadsIcon,  tile: 'bg-black',          color: 'text-white',     note: 'Short-form post publishing' },
];

// useSearchParams() requires a Suspense boundary for static prerendering.
export function ChannelAccessPanel() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>}>
      <ChannelAccessContent />
    </Suspense>
  );
}

function ChannelAccessContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();

  const justConnected = searchParams.get('connected') === 'true';
  const oauthErrorCode = searchParams.get('error') ?? '';

  const [banner, setBanner] = useState<BannerState | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlForm, setShowUrlForm] = useState(false);
  // Access level for new Google connections; per-channel changes use changeAccessMutation
  const [connectAccess, setConnectAccess] = useState<AccessLevel>('PUBLISH');
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessLevel>>({});
  // Set to true after OAuth callback redirect — we wait for channels to reload before showing success
  const pendingVerification = useRef(false);

  const { data: channels = [], isLoading: chLoading } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  // Step 1 — detect ?connected=true from OAuth callback, clean URL, trigger channel refresh
  useEffect(() => {
    if (justConnected) {
      pendingVerification.current = true;
      window.history.replaceState({}, '', '/library?tab=channels');
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
      window.history.replaceState({}, '', '/library?tab=channels');
    }
  }, [oauthErrorCode]);

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

  const activeChannels = channels.filter((c) => c.active);
  const inactiveChannels = channels.filter((c) => !c.active);

  // Any mutation touching channels is in flight
  const channelBusy =
    disconnectMutation.isPending || removeMutation.isPending ||
    reconnectMutation.isPending || refreshTokenMutation.isPending;

  return (
    <div className="space-y-10">
      {/* Global notification banner */}
      {banner && (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      )}

      {/* ── YouTube Channels ──────────────────────────────── */}
      <section id="channels" className="scroll-mt-6">
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

      {/* ── Social platforms ─────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Share2 className="w-5 h-5 text-brand-600" />
          Social Platforms
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {SOCIAL_PLATFORMS.map((p) => (
            <div key={p.key} className="flex items-center gap-4 p-4">
              <div className={`w-10 h-10 rounded-full ${p.tile} flex items-center justify-center`}>
                <p.icon className={`w-5 h-5 ${p.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{p.name}</p>
                <p className="text-sm text-gray-500">{p.note}</p>
              </div>
              <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                Coming soon
              </span>
              <button
                disabled
                title={`${p.name} publishing is on the roadmap`}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-400 text-sm rounded-lg cursor-not-allowed"
              >
                <PlusCircle className="w-4 h-4" />
                Connect
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Cross-platform publishing lands here — one panel to control every channel your content ships to.
        </p>
      </section>
    </div>
  );
}
