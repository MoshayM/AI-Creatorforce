'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { User, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api, setTokens, type OAuthProviders, type OAuthProvider } from '@/lib/api';
import { AuthShell, AuthPillInput, SocialRow, type OAuthProviderName } from '@/components/auth-shell';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';
const MOCK_TOKEN = 'mock-jwt-token-for-testing';
const OWNER_EMAIL = 'ethonanpasumvalki@gmail.com';

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<OAuthProviders | undefined>(undefined);

  // Fetch which social providers are enabled
  useEffect(() => {
    if (MOCK_MODE) return;
    api.auth.providers()
      .then((r) => setProviders(r.data))
      .catch(() => {
        setProviders({ google: false, apple: false, facebook: false });
      });
  }, []);

  // Persist referral code from URL to localStorage for later redemption
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) localStorage.setItem('cf.pendingReferralCode', ref);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    // In mock mode validate directly — no API call needed.
    if (MOCK_MODE) {
      if (form.email === OWNER_EMAIL) {
        setError('Email already registered. Please log in instead.');
        setLoading(false);
        return;
      }
      localStorage.setItem('cf_token', MOCK_TOKEN);
      router.push('/projects');
      return;
    }

    try {
      const { data } = await api.auth.register(form.email, form.password, form.name);
      setTokens(data.accessToken, data.refreshToken);
      const pending = localStorage.getItem('cf.pendingReferralCode');
      if (pending) {
        api.referral.redeem(pending).catch(() => {});
        localStorage.removeItem('cf.pendingReferralCode');
      }
      router.push('/projects');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setError('Email already registered. Please log in instead.');
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSocialRegister(provider: OAuthProviderName) {
    setError('');
    try {
      const redirectUri = `${window.location.origin}/oauth/callback/${provider}`;
      const { data } = await api.auth.oauthStart(provider as OAuthProvider, redirectUri, 'login');
      sessionStorage.setItem('cf.oauth.state', data.state);
      window.location.href = data.authUrl;
    } catch {
      setError(`Could not start ${provider} sign-up. Please try again.`);
    }
  }

  return (
    <AuthShell
      brand="AI CreatorForce"
      title="Create Account"
      subtitle="Sign up to start your journey"
      mascot="🤗"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-[#7b5ec7] font-semibold hover:underline">
            Login
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        <AuthPillInput
          icon={<User className="w-4 h-4" />}
          type="text"
          aria-label="Name"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <AuthPillInput
          icon={<Mail className="w-4 h-4" />}
          type="email"
          aria-label="Email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
        />
        <div className="relative">
          <AuthPillInput
            icon={<Lock className="w-4 h-4" />}
            type={showPassword ? 'text' : 'password'}
            aria-label="Password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#8b74d8] hover:bg-[#7a63cb] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? 'Creating account…' : 'Sign Up'}
        </button>
      </form>

      <SocialRow
        providers={providers}
        onProviderClick={(p) => { void handleSocialRegister(p); }}
      />
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterInner />
    </Suspense>
  );
}
