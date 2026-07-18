'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { User, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api, setTokens, type OAuthProviders, type OAuthProvider } from '@/lib/api';
import { AuthShell, AuthPillInput, SocialRow, type OAuthProviderName } from '@/components/auth-shell';
import CountryCodeSelect, { COUNTRIES, type Country } from '@/components/country-code-select';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';
const MOCK_TOKEN = 'mock-jwt-token-for-testing';
const OWNER_EMAIL = 'ethonanpasumvalki@gmail.com';

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>(COUNTRIES[0]); // India +91 default
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<OAuthProviders | undefined>(undefined);

  useEffect(() => {
    if (MOCK_MODE) return;
    api.auth.providers()
      .then((r) => setProviders(r.data))
      .catch(() => setProviders({ google: false, apple: false, facebook: false }));
  }, []);

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) localStorage.setItem('cf.pendingReferralCode', ref);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (MOCK_MODE) {
      if (form.email === OWNER_EMAIL) {
        setError('Email already registered. Please log in instead.');
        setLoading(false);
        return;
      }
      localStorage.setItem('cf_token', MOCK_TOKEN);
      router.push('/');
      return;
    }

    try {
      const fullPhone = phone.trim() ? `${country.dialCode}${phone.trim().replace(/^0+/, '')}` : undefined;
      const { data } = await api.auth.register(form.email, form.password, form.name, fullPhone);
      setTokens(data.accessToken, data.refreshToken);
      const pending = localStorage.getItem('cf.pendingReferralCode');
      if (pending) {
        api.referral.redeem(pending).catch(() => {});
        localStorage.removeItem('cf.pendingReferralCode');
      }
      router.push('/');
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
          placeholder="Name (optional)"
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
        {/* Optional phone — collected so the user can sign in via phone OTP later */}
        <div className="flex rounded-full border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-[#7b5ec7]/40">
          <CountryCodeSelect value={country} onChange={setCountry} />
          <input
            type="tel"
            aria-label="Phone number (optional)"
            placeholder="Phone number (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent text-gray-800 placeholder:text-gray-400"
          />
        </div>
        <div className="relative">
          <AuthPillInput
            icon={<Lock className="w-4 h-4" />}
            type={showPassword ? 'text' : 'password'}
            aria-label="Password"
            placeholder="Password (min 8 characters)"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-600"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? 'Creating account…' : 'Sign Up'}
        </button>
        <p className="text-xs text-gray-400 text-center">
          Have a phone or email? You can also{' '}
          <Link href="/login" className="text-[#7b5ec7] hover:underline">
            sign in with OTP
          </Link>{' '}
          — no sign-up needed.
        </p>
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
