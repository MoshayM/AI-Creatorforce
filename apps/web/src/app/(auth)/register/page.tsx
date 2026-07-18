'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { User, Mail, Lock, Eye, EyeOff, Loader2, KeyRound, Phone } from 'lucide-react';
import { api, setTokens, type OAuthProviders, type OAuthProvider } from '@/lib/api';
import { AuthShell, AuthPillInput, SocialRow, type OAuthProviderName } from '@/components/auth-shell';
import CountryCodeSelect, { COUNTRIES, type Country } from '@/components/country-code-select';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';
const MOCK_TOKEN = 'mock-jwt-token-for-testing';
const OWNER_EMAIL = 'ethonanpasumvalki@gmail.com';
const IS_DEV = process.env['NODE_ENV'] === 'development';

type Tab = 'password' | 'otp';
type OtpStep = 'send' | 'verify';

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('password');

  // Password fields
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [showPassword, setShowPassword] = useState(false);

  // OTP fields
  const [otpEmail, setOtpEmail] = useState('');
  const [otpName, setOtpName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStep, setOtpStep] = useState<OtpStep>('send');

  // Phone fields (for future phone-based OTP registration — email only for now)
  const [_otpCountry, setOtpCountry] = useState<Country>(COUNTRIES[0]);

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
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

  async function handlePasswordSubmit(e: React.FormEvent) {
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
      const { data } = await api.auth.register(form.email, form.password, form.name);
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

  async function handleOtpSend(e: React.FormEvent) {
    e.preventDefault();
    if (!otpEmail.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.auth.otpRegisterSend(otpEmail.trim());
      setOtpStep('verify');
      setInfo('OTP sent! Check your email.');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setError('Email already registered. Please sign in instead.');
      } else if (status === 400) {
        setError('Too many requests. Please wait a few minutes.');
      } else {
        setError('Could not send OTP. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.auth.otpRegisterVerify(otpEmail.trim(), otpCode.trim(), otpName.trim() || undefined);
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
        setError('Email already registered. Please sign in instead.');
      } else {
        setError('Invalid or expired OTP. Please try again.');
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

  function switchTab(t: Tab) {
    setTab(t);
    setError('');
    setInfo('');
    setOtpStep('send');
    setOtpCode('');
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
      {/* Tab switcher */}
      <div className="flex bg-gray-100 rounded-full p-1 mb-5">
        <button
          type="button"
          onClick={() => switchTab('password')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-full transition-colors ${tab === 'password' ? 'bg-white shadow text-[#7b5ec7]' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => switchTab('otp')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-full transition-colors ${tab === 'otp' ? 'bg-white shadow text-[#7b5ec7]' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Sign up with OTP
        </button>
      </div>

      {tab === 'password' ? (
        <form onSubmit={(e) => { void handlePasswordSubmit(e); }} className="space-y-4">
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
        </form>
      ) : (
        <div className="space-y-4">
          {otpStep === 'send' ? (
            <form onSubmit={(e) => { void handleOtpSend(e); }} className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Enter your email and we&apos;ll send you a sign-up OTP. No password needed.
              </p>
              <AuthPillInput
                icon={<User className="w-4 h-4" />}
                type="text"
                aria-label="Name (optional)"
                placeholder="Name (optional)"
                value={otpName}
                onChange={(e) => setOtpName(e.target.value)}
              />
              {/* Email + country code row */}
              <AuthPillInput
                icon={<Mail className="w-4 h-4" />}
                type="email"
                aria-label="Email"
                placeholder="Email"
                value={otpEmail}
                onChange={(e) => setOtpEmail(e.target.value)}
                required
              />
              {/* Country selector — shown for context / future phone OTP registration */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Country
                </span>
                <CountryCodeSelect
                  value={_otpCountry}
                  onChange={setOtpCountry}
                />
                <span className="text-xs text-gray-400">for phone OTP sign-in</span>
              </div>
              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
              <button
                type="submit"
                disabled={loading || !otpEmail.trim()}
                className="w-full py-3 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => { void handleOtpVerify(e); }} className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                OTP sent to <span className="font-medium text-gray-700">{otpEmail}</span>.{' '}
                <button type="button" onClick={() => { setOtpStep('send'); setError(''); setInfo(''); }} className="text-[#7b5ec7] hover:underline text-xs">Change</button>
              </p>
              <AuthPillInput
                icon={<KeyRound className="w-4 h-4" />}
                type="text"
                aria-label="6-digit OTP"
                placeholder="6-digit OTP"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
              {info && <p className="text-[#7b5ec7] text-xs text-center">{info}</p>}
              <button
                type="submit"
                disabled={loading || otpCode.length !== 6}
                className="w-full py-3 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
              {IS_DEV && (
                <button
                  type="button"
                  disabled={loading}
                  className="w-full text-xs text-amber-600 hover:underline disabled:opacity-50"
                  onClick={async () => {
                    try {
                      const { data } = await api.auth.otpDevPeek(otpEmail.trim());
                      setOtpCode(data.code);
                      setInfo(`[Dev] OTP auto-filled: ${data.code}`);
                    } catch {
                      setError('[Dev] No pending OTP found. Check API console for the OTP.');
                    }
                  }}
                >
                  [Dev] Auto-fill OTP from server
                </button>
              )}
            </form>
          )}
        </div>
      )}

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
