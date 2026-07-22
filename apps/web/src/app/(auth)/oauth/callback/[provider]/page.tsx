'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft } from 'lucide-react';
import { api, setTokens, type OAuthProvider } from '@/lib/api';
import { OAuthCallbackShell } from '@/components/auth-shell';

// ── Types ─────────────────────────────────────────────────────────────────────

type CallbackState =
  | { phase: 'verifying' }
  | { phase: 'linked';        provider: string }
  | { phase: 'link_required'; email: string; provider: string }
  | { phase: 'error';         message: string };

// ── Provider branding ─────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, { label: string; bg: string; fg: string; logo: React.ReactNode }> = {
  google: {
    label: 'Google',
    bg: '#fff',
    fg: '#4285F4',
    logo: (
      <svg viewBox="0 0 24 24" className="w-7 h-7" aria-hidden>
        <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z" />
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.1 0-5.8-2.1-6.8-5H1.3v3C3.3 21.3 7.3 24 12 24z" />
        <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4v-3H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z" />
        <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C16.9 1 14.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c1-2.9 3.7-4.9 6.8-4.9z" />
      </svg>
    ),
  },
  apple: {
    label: 'Apple',
    bg: '#000',
    fg: '#fff',
    logo: (
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white" aria-hidden>
        <path d="M16.4 12.9c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.7c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-3.7zM14 5.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
      </svg>
    ),
  },
  facebook: {
    label: 'Facebook',
    bg: '#1877F2',
    fg: '#fff',
    logo: (
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white" aria-hidden>
        <path d="M24 12c0-6.6-5.4-12-12-12S0 5.4 0 12c0 6 4.4 11 10.1 11.9v-8.4H7.1V12h3v-2.6c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4C19.6 23 24 18 24 12z" />
      </svg>
    ),
  },
};

function providerMeta(p: string) {
  return PROVIDER_META[p] ?? { label: p, bg: '#6D4AE0', fg: '#fff', logo: <span className="text-2xl text-white">🔐</span> };
}

// ── Verifying animation steps ─────────────────────────────────────────────────

const STEPS = [
  'Verifying OAuth token',
  'Securing your session',
  'Loading your workspace',
];

function VerifyingView({ provider }: { provider: string }) {
  const meta = providerMeta(provider);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setActiveStep(1), 900);
    const t2 = setTimeout(() => setActiveStep(2), 1900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="text-center">
      {/* Provider icon */}
      <div className="flex justify-center mb-7">
        <div className="relative">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg"
            style={{ background: meta.bg }}
          >
            {meta.logo}
          </div>
          {/* Spinner ring */}
          <div className="absolute -inset-2 rounded-[2rem] border-2 border-[#6D4AE0]/20 border-t-[#6D4AE0] animate-spin" />
        </div>
      </div>

      <h2 className="text-2xl font-extrabold text-gray-900 mb-1.5">
        Connecting {meta.label}
      </h2>
      <p className="text-gray-400 text-sm mb-8">
        Finishing up your sign-in — just a moment.
      </p>

      {/* Step indicators */}
      <div className="space-y-3 mb-8 text-left">
        {STEPS.map((step, i) => {
          const done    = i < activeStep;
          const current = i === activeStep;
          return (
            <div
              key={step}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-500"
              style={{
                background: done ? '#f0fdf4' : current ? '#f5f2fd' : '#f9f9fb',
                border: `1.5px solid ${done ? '#bbf7d0' : current ? '#e3ddf8' : '#f0f0f5'}`,
              }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-500"
                style={{
                  background: done ? '#22c55e' : current ? '#6D4AE0' : '#e5e7eb',
                }}
              >
                {done ? (
                  <span className="text-white text-xs font-bold">✓</span>
                ) : current ? (
                  <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-gray-300" />
                )}
              </div>
              <span
                className="text-sm font-medium transition-colors duration-300"
                style={{ color: done ? '#16a34a' : current ? '#6D4AE0' : '#9ca3af' }}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-gray-400">Do not close this window</p>
    </div>
  );
}

// ── Success / linked state ────────────────────────────────────────────────────

function LinkedView({ provider }: { provider: string }) {
  const meta = providerMeta(provider);
  return (
    <div className="text-center">
      <div className="flex justify-center mb-6">
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
          style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', boxShadow: '0 8px 32px rgba(34,197,94,0.18)' }}
        >
          ✅
        </div>
      </div>
      <h2 className="text-2xl font-extrabold text-gray-900 mb-2">
        {meta.label} connected!
      </h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-1">
        Your account is now linked.
      </p>
      <p className="text-gray-400 text-xs">Redirecting to Settings…</p>
    </div>
  );
}

// ── Link-required state ───────────────────────────────────────────────────────

function LinkRequiredView({ email, provider }: { email: string; provider: string }) {
  const meta = providerMeta(provider);
  return (
    <div>
      <div className="flex justify-center mb-6">
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
          style={{ background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', boxShadow: '0 8px 32px rgba(234,179,8,0.15)' }}
        >
          🔗
        </div>
      </div>

      <h2 className="text-2xl font-extrabold text-gray-900 mb-2 text-center">Account already exists</h2>
      <p className="text-gray-500 text-sm text-center leading-relaxed mb-6">
        A Blueforce account is already registered for{' '}
        <span className="font-semibold text-gray-700 break-all">{email}</span>.
      </p>

      {/* Steps */}
      <div
        className="rounded-2xl px-4 py-4 space-y-3.5 mb-6"
        style={{ background: '#f5f2fd', border: '1.5px solid #e3ddf8' }}
      >
        <p className="text-xs font-semibold text-[#6D4AE0] mb-1">To connect {meta.label}, do this:</p>
        {[
          { n: '1', text: 'Sign in with your existing password or OTP' },
          { n: '2', text: `Go to Settings → Connected Accounts → Link ${meta.label}` },
        ].map((s) => (
          <div key={s.n} className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-[#6D4AE0] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              {s.n}
            </div>
            <p className="text-gray-600 text-xs leading-relaxed">{s.text}</p>
          </div>
        ))}
      </div>

      <Link
        href="/login"
        className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99]"
        style={{
          background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
          boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
        }}
      >
        Sign in to your account
      </Link>
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

function ErrorView({ message }: { message: string }) {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-6">
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
          style={{ background: '#fef2f2', boxShadow: '0 8px 32px rgba(239,68,68,0.12)' }}
        >
          ⚠️
        </div>
      </div>

      <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Sign-in failed</h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-8">{message}</p>

      <Link
        href="/login"
        className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99]"
        style={{
          background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
          boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
        }}
      >
        Try again
      </Link>
    </div>
  );
}

// ── Inner (needs useSearchParams) ─────────────────────────────────────────────

function OAuthCallbackInner() {
  const router       = useRouter();
  const params       = useParams();
  const searchParams = useSearchParams();

  const provider      = (params['provider'] as string) ?? '';
  const code          = searchParams.get('code') ?? '';
  const stateFromUrl  = searchParams.get('state') ?? '';

  const [state, setState] = useState<CallbackState>({ phase: 'verifying' });

  useEffect(() => {
    async function exchange() {
      const storedState = sessionStorage.getItem('cf.oauth.state');
      sessionStorage.removeItem('cf.oauth.state');

      if (!code || !stateFromUrl) {
        setState({ phase: 'error', message: 'Missing code or state from OAuth provider. Please try signing in again.' });
        return;
      }
      if (!storedState || storedState !== stateFromUrl) {
        setState({ phase: 'error', message: 'Security check failed (state mismatch). This may indicate a CSRF attempt. Please start the sign-in again.' });
        return;
      }

      try {
        const { data } = await api.auth.oauthCallback(provider as OAuthProvider, code, stateFromUrl);

        if (data.linked === true) {
          setState({ phase: 'linked', provider });
          router.replace(`/settings?linked=${encodeURIComponent(provider)}`);
          return;
        }
        if (data.accessToken && data.refreshToken) {
          setTokens(data.accessToken, data.refreshToken);
          router.replace('/projects');
          return;
        }
        setState({ phase: 'error', message: 'Unexpected response from the server. Please try again.' });
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number; data?: { error?: string; email?: string; message?: string } } };
        if (axiosErr?.response?.status === 409 && axiosErr.response.data?.error === 'LINK_REQUIRED') {
          setState({ phase: 'link_required', email: axiosErr.response.data.email ?? '', provider });
          return;
        }
        const msg = axiosErr?.response?.data?.message;
        setState({ phase: 'error', message: typeof msg === 'string' ? msg : 'Sign-in failed. Please try again.' });
      }
    }

    void exchange();
  }, []);

  return (
    <OAuthCallbackShell
      footer={
        state.phase === 'verifying' ? null : (
          <Link href="/login" className="inline-flex items-center gap-1.5 text-[#6D4AE0] font-semibold hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </Link>
        )
      }
    >
      {state.phase === 'verifying'      && <VerifyingView provider={provider} />}
      {state.phase === 'linked'         && <LinkedView provider={state.provider} />}
      {state.phase === 'link_required'  && <LinkRequiredView email={state.email} provider={state.provider} />}
      {state.phase === 'error'          && <ErrorView message={state.message} />}
    </OAuthCallbackShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <OAuthCallbackShell footer={null}>
          <VerifyingView provider="" />
        </OAuthCallbackShell>
      }
    >
      <OAuthCallbackInner />
    </Suspense>
  );
}
