'use client';
import React, { Suspense, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Loader2, CheckCircle,
  LogOut, XCircle, Eye,
  Key, Save, EyeOff, Shield, Monitor, Unlink, Link2, Phone, User,
  Webhook, Trash2, Play, ChevronDown, Mail, Plus,
} from 'lucide-react';
import { api, apiClient, type OAuthProvider, type AuthSession, type LinkedAccount, type OAuthProviders, type AuthLinksResponse } from '@/lib/api';

interface WebhookEntry {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
  lastDeliveryAt?: string | null;
  lastStatus?: 'success' | 'failed' | null;
}
import { Banner, type BannerState } from '@/components/banner';

interface ApiKeyEntry {
  key: string;
  label: string;
  masked: string;
  set: boolean;
}

const COUNTRY_CODES = [
  { code: '+1',   flag: '🇺🇸', name: 'United States' },
  { code: '+1',   flag: '🇨🇦', name: 'Canada' },
  { code: '+44',  flag: '🇬🇧', name: 'United Kingdom' },
  { code: '+91',  flag: '🇮🇳', name: 'India' },
  { code: '+61',  flag: '🇦🇺', name: 'Australia' },
  { code: '+49',  flag: '🇩🇪', name: 'Germany' },
  { code: '+33',  flag: '🇫🇷', name: 'France' },
  { code: '+81',  flag: '🇯🇵', name: 'Japan' },
  { code: '+55',  flag: '🇧🇷', name: 'Brazil' },
  { code: '+52',  flag: '🇲🇽', name: 'Mexico' },
  { code: '+34',  flag: '🇪🇸', name: 'Spain' },
  { code: '+39',  flag: '🇮🇹', name: 'Italy' },
  { code: '+7',   flag: '🇷🇺', name: 'Russia' },
  { code: '+82',  flag: '🇰🇷', name: 'South Korea' },
  { code: '+86',  flag: '🇨🇳', name: 'China' },
  { code: '+65',  flag: '🇸🇬', name: 'Singapore' },
  { code: '+971', flag: '🇦🇪', name: 'UAE' },
  { code: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { code: '+234', flag: '🇳🇬', name: 'Nigeria' },
  { code: '+27',  flag: '🇿🇦', name: 'South Africa' },
  { code: '+62',  flag: '🇮🇩', name: 'Indonesia' },
  { code: '+60',  flag: '🇲🇾', name: 'Malaysia' },
  { code: '+63',  flag: '🇵🇭', name: 'Philippines' },
  { code: '+66',  flag: '🇹🇭', name: 'Thailand' },
  { code: '+64',  flag: '🇳🇿', name: 'New Zealand' },
  { code: '+31',  flag: '🇳🇱', name: 'Netherlands' },
  { code: '+46',  flag: '🇸🇪', name: 'Sweden' },
  { code: '+41',  flag: '🇨🇭', name: 'Switzerland' },
  { code: '+47',  flag: '🇳🇴', name: 'Norway' },
  { code: '+45',  flag: '🇩🇰', name: 'Denmark' },
  { code: '+20',  flag: '🇪🇬', name: 'Egypt' },
  { code: '+92',  flag: '🇵🇰', name: 'Pakistan' },
  { code: '+880', flag: '🇧🇩', name: 'Bangladesh' },
  { code: '+94',  flag: '🇱🇰', name: 'Sri Lanka' },
  { code: '+977', flag: '🇳🇵', name: 'Nepal' },
  { code: '+93',  flag: '🇦🇫', name: 'Afghanistan' },
];

function parsePhone(full: string): { code: string; local: string } {
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const cc of sorted) {
    if (full.startsWith(cc.code)) return { code: cc.code, local: full.slice(cc.code.length).trim() };
  }
  return { code: '+1', local: full };
}

function SettingsContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();

  const justLinkedProvider = searchParams.get('linked') ?? '';

  const [banner, setBanner] = useState<BannerState | null>(null);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [phone, setPhone] = useState('');
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  // ── Phone + country code state ──────────────────────────────────────────────
  const [countryCode, setCountryCode] = useState('+1');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [ccOpen, setCcOpen] = useState(false);
  const [ccSearch, setCcSearch] = useState('');

  // ── OTP email state ──────────────────────────────────────────────────────────
  const [otpEmail, setOtpEmail] = useState('');
  const [otpEmailSaved, setOtpEmailSaved] = useState(false);

  // ── Webhook state ───────────────────────────────────────────────────────────
  const [showAddWebhookForm, setShowAddWebhookForm] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([]);
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [webhookTestResults, setWebhookTestResults] = useState<Record<string, { delivered: boolean; statusCode?: number; error?: string } | null>>({});

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me().then((r) => r.data),
  });

  const isOwner = me?.role === 'OWNER' || me?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (me?.phone) {
      const { code, local } = parsePhone(me.phone);
      setCountryCode(code);
      setPhoneLocal(local);
    }
    // @ts-expect-error otpEmail may not be in API type yet
    if (me?.otpEmail) setOtpEmail((me as Record<string, unknown>).otpEmail as string ?? '');
  }, [me?.phone]);

  useEffect(() => {
    if (me?.name != null) setProfileName(me.name ?? '');
    if (me?.avatarUrl != null) setProfileAvatar(me.avatarUrl ?? '');
  }, [me?.name, me?.avatarUrl]);

  // ── Sign-in & security queries ──────────────────────────────────────────────

  const { data: authLinks, refetch: refetchLinks } = useQuery<AuthLinksResponse>({
    queryKey: ['auth-links'],
    queryFn: () => api.auth.links().then((r) => r.data),
  });

  const { data: oauthProviders } = useQuery<OAuthProviders>({
    queryKey: ['oauth-providers'],
    queryFn: () => api.auth.providers().then((r) => r.data),
  });

  const { data: sessions = [], isLoading: sessionsLoading, refetch: refetchSessions } = useQuery<AuthSession[]>({
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

  // Handle ?linked=<provider> from OAuth link callback
  useEffect(() => {
    if (justLinkedProvider) {
      const label = justLinkedProvider.charAt(0).toUpperCase() + justLinkedProvider.slice(1);
      setBanner({ type: 'success', message: `${label} account linked successfully.` });
      window.history.replaceState({}, '', '/settings');
      void refetchLinks();
    }
  }, [justLinkedProvider]);

  const updatePhoneMutation = useMutation({
    mutationFn: (value: string | null) => api.auth.updatePhone(value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      setPhoneSaved(true);
      setBanner({ type: 'success', message: phoneLocal.trim() ? 'Phone number saved.' : 'Phone number removed.' });
      setTimeout(() => setPhoneSaved(false), 3000);
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setBanner({ type: 'error', message: 'That phone number is already linked to another account.' });
      } else {
        setBanner({ type: 'error', message: 'Failed to update phone number.' });
      }
    },
  });

  const updateOtpEmailMutation = useMutation({
    mutationFn: (value: string | null) => apiClient.patch('/auth/me', { otpEmail: value || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      setOtpEmailSaved(true);
      setBanner({ type: 'success', message: otpEmail.trim() ? 'OTP email saved.' : 'OTP email removed.' });
      setTimeout(() => setOtpEmailSaved(false), 3000);
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setBanner({ type: 'error', message: 'That email is already linked to another account.' });
      } else {
        setBanner({ type: 'error', message: 'Failed to update OTP email.' });
      }
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: () => api.auth.updateProfile({ name: profileName, avatarUrl: profileAvatar }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      setProfileSaved(true);
      setBanner({ type: 'success', message: 'Profile updated.' });
      setTimeout(() => setProfileSaved(false), 3000);
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Failed to update profile.' });
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

  // ── Webhook queries & mutations ─────────────────────────────────────────────
  const { data: webhooks = [] } = useQuery<WebhookEntry[]>({
    queryKey: ['dev-webhooks'],
    queryFn: () =>
      apiClient.get<{ webhooks: WebhookEntry[] }>('/dev/webhooks').then((r) => r.data.webhooks ?? []),
    enabled: isOwner,
  });


  const createWebhookMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/dev/webhooks', {
        url: newWebhookUrl,
        events: newWebhookEvents,
        ...(newWebhookSecret ? { secret: newWebhookSecret } : {}),
      }),
    onSuccess: () => {
      setShowAddWebhookForm(false);
      setNewWebhookUrl('');
      setNewWebhookEvents([]);
      setNewWebhookSecret('');
      void qc.invalidateQueries({ queryKey: ['dev-webhooks'] });
      setBanner({ type: 'success', message: 'Webhook created.' });
    },
    onError: () => setBanner({ type: 'error', message: 'Failed to create webhook.' }),
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/dev/webhooks/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dev-webhooks'] }),
    onError: () => setBanner({ type: 'error', message: 'Failed to delete webhook.' }),
  });

  async function testWebhook(id: string) {
    try {
      const res = await apiClient.post<{ delivered: boolean; statusCode?: number; error?: string }>(
        `/dev/webhooks/${id}/test`,
      );
      setWebhookTestResults((prev) => ({ ...prev, [id]: res.data }));
    } catch {
      setWebhookTestResults((prev) => ({ ...prev, [id]: { delivered: false, error: 'Request failed' } }));
    }
  }

  const WEBHOOK_EVENTS = [
    { value: 'video.completed', label: 'Video completed' },
    { value: 'video.published', label: 'Video published' },
    { value: 'job.failed', label: 'Job failed' },
    { value: 'calendar.proposed', label: 'Calendar proposed' },
    { value: 'calendar.approved', label: 'Calendar approved' },
  ];

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Settings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your profile, security, and developer integrations</p>
        </div>

        {/* Global notification banner */}
        {banner && (
          <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
        )}

        {/* ── Profile ──────────────────────────────────────────────────── */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Profile</p>
          <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="flex items-center gap-2 mb-4">
              <User className="w-5 h-5" style={{ color: '#6D4AE0' }} />
              <span className="text-sm font-semibold text-gray-800">Your Profile</span>
            </div>
            <div className="flex items-center gap-5 mb-5">
              {profileAvatar ? (
                <img
                  src={profileAvatar}
                  alt="Avatar"
                  className="w-16 h-16 rounded-full object-cover shrink-0"
                  style={{ border: '2px solid #e3ddf8' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div suppressHydrationWarning className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shrink-0 select-none">
                  {me?.name?.[0]?.toUpperCase() ?? ''}
                </div>
              )}
              <div className="text-sm text-gray-500">
                <p suppressHydrationWarning className="font-medium text-gray-700">{me?.email ?? ''}</p>
                <p suppressHydrationWarning className="text-xs mt-0.5 capitalize">{me?.role?.toLowerCase() ?? ''}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Display name</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                  style={{ border: '1.5px solid #e3e0f0' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Avatar URL <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="url"
                  value={profileAvatar}
                  onChange={(e) => setProfileAvatar(e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                  className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                  style={{ border: '1.5px solid #e3e0f0' }}
                />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => updateProfileMutation.mutate()}
                  disabled={updateProfileMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-2xl font-bold text-white text-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
                  style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
                >
                  {updateProfileMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : profileSaved
                    ? <CheckCircle className="w-3.5 h-3.5" />
                    : <Save className="w-3.5 h-3.5" />}
                  {profileSaved ? 'Saved!' : 'Save Profile'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Sign-in & security ───────────────────────────────────────── */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Sign-in &amp; Security</p>

          {/* Linked accounts */}
          <div className="bg-white rounded-2xl mb-4 overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #f0edf9' }}>
              <Shield className="w-4 h-4" style={{ color: '#6D4AE0' }} />
              <div>
                <p className="text-sm font-semibold text-gray-800">Linked accounts</p>
                <p className="text-xs text-gray-500 mt-0.5">Connect social accounts to sign in without a password.</p>
              </div>
            </div>
            {(['google', 'apple'] as OAuthProvider[]).map((provider) => {
              const label = provider.charAt(0).toUpperCase() + provider.slice(1);
              const linkedAccount: LinkedAccount | undefined = authLinks?.links.find((l) => l.provider === provider);
              const providerEnabled = oauthProviders?.[provider] ?? false;
              const isPending = unlinkProviderMutation.isPending || linkProviderMutation.isPending;

              return (
                <div key={provider} className="flex items-center gap-4 px-4 py-3 hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
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
                      className="flex items-center gap-1.5 px-3 py-1.5 text-red-600 text-xs rounded-2xl hover:bg-red-50 transition-colors disabled:opacity-40"
                      style={{ border: '1.5px solid #fecaca' }}
                    >
                      {unlinkProviderMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                      Disconnect
                    </button>
                  ) : providerEnabled ? (
                    <button
                      onClick={() => linkProviderMutation.mutate(provider)}
                      disabled={isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-2xl hover:bg-[#f5f2fd] transition-colors disabled:opacity-40 font-semibold text-gray-600"
                      style={{ border: '1.5px solid #e3ddf8', color: '#6D4AE0' }}
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

          {/* Content channels — link to Media Control */}
          <div className="bg-white rounded-2xl mb-4 overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #f0edf9' }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" aria-hidden>
                <rect x="2" y="7" width="20" height="15" rx="2" stroke="#6D4AE0" strokeWidth="1.8" />
                <path d="M16 2 8 2 2 7h20z" fill="#e3ddf8" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-gray-800">Content Channels</p>
                <p className="text-xs text-gray-500 mt-0.5">Connect and manage all your publishing accounts in one place.</p>
              </div>
            </div>
            <div className="px-4 py-5 flex items-center justify-between gap-4">
              <p className="text-sm text-gray-600">YouTube, Instagram, TikTok, Facebook, X, LinkedIn, Threads — all managed from <span className="font-semibold text-gray-800">Media Control → Channel Access</span>.</p>
              <a
                href="/library?tab=channels"
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-2xl font-bold text-white text-sm hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)', textDecoration: 'none' }}
              >
                <Plus className="w-3.5 h-3.5" /> Manage Channels
              </a>
            </div>
          </div>

          {/* Phone number */}
          <div className="bg-white rounded-2xl mb-4 overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid #f0edf9' }}>
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                <Phone className="w-4 h-4 text-gray-500" />
                Phone number
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Optional. Add a phone number to sign in with OTP codes.</p>
            </div>
            <div className="px-4 py-3 flex items-center gap-3">
              {/* Country code picker */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => { setCcOpen(o => !o); setCcSearch(''); }}
                  className="flex items-center gap-1.5 h-[46px] px-3 rounded-2xl text-sm font-medium text-gray-700 bg-white hover:bg-[#faf9ff] transition-colors"
                  style={{ border: '1.5px solid #e3e0f0', minWidth: '88px' }}
                >
                  <span className="text-base leading-none">{COUNTRY_CODES.find(c => c.code === countryCode)?.flag ?? '🌐'}</span>
                  <span className="font-semibold text-[13px]">{countryCode}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" style={{ transform: ccOpen ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }} />
                </button>
                {ccOpen && (
                  <div
                    className="absolute left-0 bottom-full mb-1 bg-white z-50 rounded-2xl overflow-hidden"
                    style={{ width: '240px', border: '1.5px solid #e3ddf8', boxShadow: '0 16px 40px -12px rgba(30,27,46,.22)' }}
                  >
                    <div className="px-3 py-2" style={{ borderBottom: '1px solid #f0edf9' }}>
                      <input
                        autoFocus
                        type="text"
                        value={ccSearch}
                        onChange={e => setCcSearch(e.target.value)}
                        placeholder="Search country…"
                        className="w-full text-sm outline-none bg-transparent text-gray-700 placeholder:text-gray-400"
                      />
                    </div>
                    <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                      {COUNTRY_CODES.filter(c =>
                        c.name.toLowerCase().includes(ccSearch.toLowerCase()) ||
                        c.code.includes(ccSearch)
                      ).map((c, i) => (
                        <button
                          key={`${c.code}-${i}`}
                          type="button"
                          onClick={() => { setCountryCode(c.code); setCcOpen(false); setCcSearch(''); }}
                          className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left hover:bg-[#f5f2fd] transition-colors"
                          style={{ background: c.code === countryCode && c.flag === (COUNTRY_CODES.find(x => x.code === countryCode)?.flag) ? '#f5f2fd' : 'transparent' }}
                        >
                          <span className="text-base w-5 text-center">{c.flag}</span>
                          <span className="flex-1 text-gray-700">{c.name}</span>
                          <span className="font-semibold text-gray-500 text-xs">{c.code}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <input
                type="tel"
                value={phoneLocal}
                onChange={e => setPhoneLocal(e.target.value)}
                placeholder="555 000 0000"
                className="flex-1 bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
              <button
                onClick={() => {
                  const full = phoneLocal.trim() ? `${countryCode}${phoneLocal.trim()}` : null;
                  updatePhoneMutation.mutate(full);
                }}
                disabled={updatePhoneMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl font-bold text-white text-xs hover:opacity-90 active:scale-[0.98] disabled:opacity-50 shrink-0 transition-all"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
              >
                {updatePhoneMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : phoneSaved
                  ? <CheckCircle className="w-3 h-3" />
                  : <Save className="w-3 h-3" />}
                {phoneLocal.trim() ? 'Save' : 'Remove'}
              </button>
            </div>
          </div>

          {/* Email for OTP login */}
          <div className="bg-white rounded-2xl mb-4 overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid #f0edf9' }}>
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-gray-500" />
                Email for OTP login
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Add a secondary email to receive one-time password sign-in codes.</p>
            </div>
            <div className="px-4 py-3 flex items-center gap-3">
              <input
                type="email"
                value={otpEmail}
                onChange={e => setOtpEmail(e.target.value)}
                placeholder="secondary@example.com (optional)"
                className="flex-1 bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
              <button
                onClick={() => updateOtpEmailMutation.mutate(otpEmail.trim() || null)}
                disabled={updateOtpEmailMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl font-bold text-white text-xs hover:opacity-90 active:scale-[0.98] disabled:opacity-50 shrink-0 transition-all"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
              >
                {updateOtpEmailMutation.isPending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : otpEmailSaved
                  ? <CheckCircle className="w-3 h-3" />
                  : <Save className="w-3 h-3" />}
                {otpEmail.trim() ? 'Save' : 'Remove'}
              </button>
            </div>
          </div>

          {/* Active sessions — OWNER / SUPER_ADMIN only */}
          {isOwner && <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="px-4 py-3 flex items-center justify-between gap-4" style={{ borderBottom: '1px solid #f0edf9' }}>
              <div>
                <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <Monitor className="w-4 h-4 text-gray-500" />
                  Active sessions
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Devices currently signed in to your account.</p>
              </div>
              {sessions.filter((s) => !s.current).length > 0 && (
                <button
                  onClick={() => revokeAllOtherSessionsMutation.mutate()}
                  disabled={revokeAllOtherSessionsMutation.isPending}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-red-600 text-xs rounded-2xl hover:bg-red-50 transition-colors disabled:opacity-40"
                  style={{ border: '1.5px solid #fecaca' }}
                >
                  {revokeAllOtherSessionsMutation.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <LogOut className="w-3 h-3" />}
                  Sign out all other sessions
                </button>
              )}
            </div>

            {sessions.length === 0 && !sessionsLoading && (
              <div className="px-4 py-6 text-center text-sm text-gray-500">No active sessions found.</div>
            )}

            {sessions.map((session) => {
              const deviceLabel = session.device.length > 60
                ? session.device.slice(0, 57) + '…'
                : session.device;
              const isConfirming = confirmRevokeSession === session.id;

              return (
                <div key={session.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
                  <Monitor className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-gray-700 truncate">{deviceLabel}</p>
                      {session.current && (
                        <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap" style={{ background: '#ecfdf5', color: '#065f46' }}>
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
                        className="px-3 py-1 bg-red-600 text-white text-xs rounded-2xl hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        {revokeSessionMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                        Yes, revoke
                      </button>
                      <button
                        onClick={() => setConfirmRevokeSession(null)}
                        className="px-3 py-1 text-xs rounded-2xl hover:bg-gray-50 font-semibold text-gray-600"
                        style={{ border: '1.5px solid #e3ddf8' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRevokeSession(session.id)}
                      disabled={revokeSessionMutation.isPending}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-gray-600 text-xs rounded-2xl hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 font-semibold"
                      style={{ border: '1.5px solid #e3ddf8' }}
                    >
                      <XCircle className="w-3 h-3" />
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>}
        </section>

        {/* ── Developer Webhooks — OWNER / SUPER_ADMIN only ───────────── */}
        {isOwner && <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Developer Webhooks</p>
          <div className="bg-white rounded-2xl mb-3" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #f0edf9' }}>
              <Webhook className="w-4 h-4" style={{ color: '#6D4AE0' }} />
              <div>
                <p className="text-sm font-semibold text-gray-800">Webhooks</p>
                <p className="text-xs text-gray-500 mt-0.5">Receive HTTP POST notifications when events happen in your account.</p>
              </div>
            </div>

            {webhooks.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-500">No webhooks yet.</div>
            )}
            {webhooks.map((wh) => {
              const testResult = webhookTestResults[wh.id];
              return (
                <div key={wh.id} className="px-4 py-3 space-y-2 hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono text-gray-800 truncate">{wh.url}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {wh.events.map((ev) => (
                          <span key={ev} className="text-[11px] font-bold rounded-full px-2.5 py-0.5" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{ev}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        title={wh.lastStatus ?? 'Never delivered'}
                        className={`w-2 h-2 rounded-full ${wh.lastStatus === 'success' ? 'bg-green-500' : wh.lastStatus === 'failed' ? 'bg-red-500' : 'bg-gray-300'}`}
                      />
                      <button
                        onClick={() => void testWebhook(wh.id)}
                        title="Send test event"
                        className="p-1.5 text-gray-500 hover:bg-[#f5f2fd] rounded-2xl transition-colors"
                        style={{ color: '#6D4AE0' }}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { if (window.confirm('Delete this webhook?')) deleteWebhookMutation.mutate(wh.id); }}
                        disabled={deleteWebhookMutation.isPending}
                        title="Delete webhook"
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-colors disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {testResult !== undefined && testResult !== null && (
                    <p className={`text-xs px-2 py-1 rounded-2xl ${testResult.delivered ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {testResult.delivered
                        ? `Delivered (HTTP ${testResult.statusCode ?? '?'})`
                        : `Failed${testResult.error ? `: ${testResult.error}` : ''}`}
                    </p>
                  )}
                </div>
              );
            })}

            {/* Add webhook form */}
            {showAddWebhookForm ? (
              <div className="px-4 py-4 space-y-3">
                <p className="text-sm font-semibold text-gray-800">New webhook</p>
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  placeholder="https://your-server.com/webhook"
                  className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                  style={{ border: '1.5px solid #e3e0f0' }}
                  required
                />
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Events</p>
                  <div className="grid grid-cols-2 gap-2">
                    {WEBHOOK_EVENTS.map((ev) => (
                      <label key={ev.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newWebhookEvents.includes(ev.value)}
                          onChange={(e) =>
                            setNewWebhookEvents((prev) =>
                              e.target.checked ? [...prev, ev.value] : prev.filter((x) => x !== ev.value),
                            )
                          }
                          className="w-4 h-4 rounded"
                          style={{ accentColor: '#6D4AE0' }}
                        />
                        {ev.label}
                      </label>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  value={newWebhookSecret}
                  onChange={(e) => setNewWebhookSecret(e.target.value)}
                  placeholder="Optional signing secret"
                  className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                  style={{ border: '1.5px solid #e3e0f0' }}
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setShowAddWebhookForm(false); setNewWebhookUrl(''); setNewWebhookEvents([]); setNewWebhookSecret(''); }}
                    className="px-3 py-1.5 text-sm rounded-2xl hover:bg-gray-50 font-semibold text-gray-600"
                    style={{ border: '1.5px solid #e3ddf8' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => createWebhookMutation.mutate()}
                    disabled={createWebhookMutation.isPending || !newWebhookUrl.trim() || newWebhookEvents.length === 0}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-2xl font-bold text-white text-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
                    style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
                  >
                    {createWebhookMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3">
                <button
                  onClick={() => setShowAddWebhookForm(true)}
                  className="flex items-center gap-1.5 text-sm font-bold hover:opacity-80 transition-opacity"
                  style={{ color: '#6D4AE0' }}
                >
                  <span className="text-lg leading-none">+</span> Add Webhook
                </button>
              </div>
            )}
          </div>
        </section>}

        {/* ── API Keys (Owner only) ─────────────────────────── */}
        {isOwner && (
          <section>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">API Keys</p>
            <div className="bg-white rounded-2xl mb-3" style={{ border: '1.5px solid #e3ddf8' }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #f0edf9' }}>
                <Key className="w-4 h-4" style={{ color: '#6D4AE0' }} />
                <div>
                  <p className="text-sm font-semibold text-gray-800">API Keys</p>
                  <p className="text-xs text-gray-500 mt-0.5">Configure provider API keys used by the AI agents. Visible to owner only.</p>
                </div>
              </div>

              {apiKeys.map((entry) => {
                const draft = apiKeyDrafts[entry.key];
                const displayValue = draft !== undefined ? draft : '';
                const isVisible = showKeys[entry.key] ?? false;

                return (
                  <div key={entry.key} className="p-4 flex items-center gap-4 hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
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
                          className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all font-mono pr-10 placeholder:text-gray-500 placeholder:font-sans"
                          style={{ border: '1.5px solid #e3e0f0' }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeys((p) => ({ ...p, [entry.key]: !isVisible }))}
                          aria-label={isVisible ? 'Hide key' : 'Show key'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-600"
                        >
                          {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {entry.set && draft === undefined && (
                        <span className="flex items-center gap-1 text-xs font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap" style={{ background: '#ecfdf5', color: '#065f46' }}>
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
                  className="flex items-center gap-2 px-5 py-2 rounded-2xl font-bold text-white text-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
                  style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
                >
                  {saveApiKeysMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                    : <><Save className="w-4 h-4" /> Save API Keys</>}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#6D4AE0' }} /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
