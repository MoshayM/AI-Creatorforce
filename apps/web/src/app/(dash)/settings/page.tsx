'use client';
import React, { Suspense, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Loader2, CheckCircle,
  LogOut, XCircle, Eye,
  Key, Save, EyeOff, Shield, Monitor, Unlink, Link2, Phone, User,
} from 'lucide-react';
import { api, type OAuthProvider, type AuthSession, type LinkedAccount, type OAuthProviders, type AuthLinksResponse } from '@/lib/api';
import { Banner, type BannerState } from '@/components/banner';

interface ApiKeyEntry {
  key: string;
  label: string;
  masked: string;
  set: boolean;
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

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me().then((r) => r.data),
  });

  const isOwner = me?.role === 'OWNER' || me?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (me?.phone) setPhone(me.phone);
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
      setBanner({ type: 'success', message: phone.trim() ? 'Phone number saved.' : 'Phone number removed.' });
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

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Global notification banner */}
      {banner && (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      )}

      {/* ── Profile ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="w-5 h-5 text-brand-600" />
          Profile
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-5 mb-5">
            {profileAvatar ? (
              <img
                src={profileAvatar}
                alt="Avatar"
                className="w-16 h-16 rounded-full object-cover border-2 border-gray-200 shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shrink-0 select-none">
                {(me?.name ?? 'C')[0]?.toUpperCase()}
              </div>
            )}
            <div className="text-sm text-gray-500">
              <p className="font-medium text-gray-700">{me?.email}</p>
              <p className="text-xs mt-0.5 capitalize">{me?.role?.toLowerCase() ?? 'member'}</p>
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Avatar URL <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="url"
                value={profileAvatar}
                onChange={(e) => setProfileAvatar(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={() => updateProfileMutation.mutate()}
                disabled={updateProfileMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50"
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

        {/* Phone number */}
        <div className="bg-white border border-gray-200 rounded-xl mb-4">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              <Phone className="w-4 h-4 text-gray-500" />
              Phone number
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Optional. Add a phone number to sign in with OTP codes.</p>
          </div>
          <div className="px-4 py-3 flex items-center gap-3">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000 (optional)"
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              onClick={() => updatePhoneMutation.mutate(phone.trim() || null)}
              disabled={updatePhoneMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700 disabled:opacity-50 shrink-0"
            >
              {updatePhoneMutation.isPending
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : phoneSaved
                ? <CheckCircle className="w-3 h-3" />
                : <Save className="w-3 h-3" />}
              {phone.trim() ? 'Save' : 'Remove'}
            </button>
          </div>
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

          {sessions.length === 0 && !sessionsLoading && (
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
