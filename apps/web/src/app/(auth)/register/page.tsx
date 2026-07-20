'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { User, AtSign, Lock, Eye, EyeOff, Loader2, Phone } from 'lucide-react';
import { api, setTokens, type OAuthProviders, type OAuthProvider } from '@/lib/api';
import { RegisterShell, LoginInput, SocialRow, type OAuthProviderName } from '@/components/auth-shell';
import CountryCodeSelect, { COUNTRIES, type Country } from '@/components/country-code-select';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';
const MOCK_TOKEN = 'mock-jwt-token-for-testing';
const OWNER_EMAIL = 'ethonanpasumvalki@gmail.com';

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
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
      router.push('/home');
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
      router.push('/home');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setError('Email already registered. Please log in instead.');
      } else if (status === 429) {
        setError('Too many sign-up attempts. Please wait a minute and try again.');
      } else if (!status) {
        setError('Cannot reach the server. Make sure the API is running.');
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
    <RegisterShell
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-[#6D4AE0] font-semibold hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        {/* Name */}
        <LoginInput
          icon={<User className="w-4 h-4" />}
          label="Full name"
          type="text"
          aria-label="Name"
          placeholder="Optional"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />

        {/* Email */}
        <LoginInput
          icon={<AtSign className="w-4 h-4" />}
          label="Email address"
          type="email"
          aria-label="Email"
          placeholder="you@example.com"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
        />

        {/* Phone — optional, enables phone OTP sign-in later */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Phone number
            <span className="ml-1.5 text-[10px] text-gray-400 font-normal">(optional — enables OTP sign-in)</span>
          </label>
          <div
            className="flex items-center bg-white rounded-2xl transition-all focus-within:ring-2 focus-within:ring-[#6D4AE0]/20 focus-within:border-[#6D4AE0]"
            style={{ border: '1.5px solid #e3e0f0' }}
          >
            <CountryCodeSelect value={country} onChange={setCountry} />
            <input
              type="tel"
              aria-label="Phone number (optional)"
              placeholder="Mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              className="flex-1 px-3 py-3 text-sm outline-none bg-transparent text-gray-800 placeholder:text-gray-400"
            />
            <Phone className="w-4 h-4 text-gray-300 mr-3 shrink-0" aria-hidden />
          </div>
        </div>

        {/* Password */}
        <LoginInput
          icon={<Lock className="w-4 h-4" />}
          label="Password"
          type={showPassword ? 'text' : 'password'}
          aria-label="Password"
          placeholder="Min 8 characters"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          required
          rightElement={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
        />

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
            <span className="text-red-400 text-sm" aria-hidden>⚠</span>
            <p className="text-red-600 text-xs font-medium">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99]"
          style={{
            background: loading ? '#8b74d8' : 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
            boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
          }}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? 'Creating account…' : 'Create free account'}
        </button>

        {/* Terms note */}
        <p className="text-[11px] text-gray-400 text-center leading-relaxed">
          By signing up you agree to our{' '}
          <Link href="/terms" className="text-[#6D4AE0] hover:underline">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="text-[#6D4AE0] hover:underline">Privacy Policy</Link>.
        </p>
      </form>

      <SocialRow
        providers={providers}
        onProviderClick={(p) => { void handleSocialRegister(p); }}
      />
    </RegisterShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterInner />
    </Suspense>
  );
}
