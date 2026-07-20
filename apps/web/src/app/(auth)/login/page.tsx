'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, KeyRound, Phone, Mail, Lock, AtSign } from 'lucide-react';
import { api, setTokens, type OAuthProviders, type OAuthProvider } from '@/lib/api';
import { LoginShell, LoginInput, SocialRow, type OAuthProviderName } from '@/components/auth-shell';
import CountryCodeSelect, { COUNTRIES, type Country } from '@/components/country-code-select';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';
const MOCK_TOKEN = 'mock-jwt-token-for-testing';
const IS_DEV = process.env['NODE_ENV'] === 'development';

type Tab = 'password' | 'otp';
type OtpStep = 'send' | 'verify';
type OtpMode = 'email' | 'phone';

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('password');

  // Password fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // OTP fields
  const [otpMode, setOtpMode] = useState<OtpMode>('email');
  const [otpEmail, setOtpEmail] = useState('');
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCountry, setOtpCountry] = useState<Country>(COUNTRIES[0]);
  const [otpCode, setOtpCode] = useState('');
  const [otpStep, setOtpStep] = useState<OtpStep>('send');

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<OAuthProviders | undefined>(undefined);

  const otpIdentifier =
    otpMode === 'email'
      ? otpEmail.trim()
      : `${otpCountry.dialCode}${otpPhone.trim().replace(/^0+/, '')}`;

  useEffect(() => {
    if (MOCK_MODE) return;
    api.auth.providers()
      .then((r) => setProviders(r.data))
      .catch(() => setProviders({ google: false, apple: false, facebook: false }));
  }, []);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (MOCK_MODE) {
      if (email && password) {
        localStorage.setItem('cf_token', MOCK_TOKEN);
        router.push('/home');
      } else {
        setError('Invalid email or password');
        setLoading(false);
      }
      return;
    }

    try {
      const { data } = await api.auth.login(email, password);
      setTokens(data.accessToken, data.refreshToken);
      router.push('/home');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        setError('Invalid email or password.');
      } else if (status === 429) {
        setError('Too many attempts. Please wait a minute and try again.');
      } else if (!status) {
        setError('Cannot reach the server. Make sure the API is running.');
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSend(e: React.FormEvent) {
    e.preventDefault();
    if (!otpIdentifier) return;
    setLoading(true);
    setError('');
    try {
      await api.auth.otpSend(otpIdentifier);
      setOtpStep('verify');
      setInfo('OTP sent! Check your ' + (otpMode === 'email' ? 'email.' : 'phone.'));
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 400) {
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
    if (!otpCode.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.auth.otpVerify(otpIdentifier, otpCode.trim());
      setTokens(data.accessToken, data.refreshToken);
      router.push('/home');
    } catch {
      setError('Invalid or expired OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSocialLogin(provider: OAuthProviderName) {
    setError('');
    try {
      const redirectUri = `${window.location.origin}/oauth/callback/${provider}`;
      const { data } = await api.auth.oauthStart(provider as OAuthProvider, redirectUri, 'login');
      sessionStorage.setItem('cf.oauth.state', data.state);
      window.location.href = data.authUrl;
    } catch {
      setError(`Could not start ${provider} sign-in. Please try again.`);
    }
  }

  function switchTab(t: Tab) {
    setTab(t);
    setError('');
    setInfo('');
    setOtpStep('send');
    setOtpCode('');
  }

  function switchOtpMode(m: OtpMode) {
    setOtpMode(m);
    setError('');
    setInfo('');
  }

  return (
    <LoginShell
      footer={
        <>
          Don&rsquo;t have an account?{' '}
          <Link href="/register" className="text-[#6D4AE0] font-semibold hover:underline">
            Create one free
          </Link>
        </>
      }
    >
      {/* ── Tab switcher ────────────────────────────────────────────── */}
      <div className="flex bg-[#f0edf9] rounded-2xl p-1 mb-6">
        <button
          type="button"
          onClick={() => switchTab('password')}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            tab === 'password'
              ? 'bg-white shadow text-[#6D4AE0]'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => switchTab('otp')}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            tab === 'otp'
              ? 'bg-white shadow text-[#6D4AE0]'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          Sign in with OTP
        </button>
      </div>

      {/* ── Password tab ─────────────────────────────────────────────── */}
      {tab === 'password' ? (
        <form onSubmit={(e) => { void handlePasswordSubmit(e); }} className="space-y-4">
          <LoginInput
            icon={<AtSign className="w-4 h-4" />}
            label="Email address"
            type="email"
            aria-label="Email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <LoginInput
            icon={<Lock className="w-4 h-4" />}
            label="Password"
            type={showPassword ? 'text' : 'password'}
            aria-label="Password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => router.push('/forgot-password')}
              className="text-xs text-[#6D4AE0] hover:underline font-medium"
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
              <span className="text-red-400 text-sm" aria-hidden>⚠</span>
              <p className="text-red-600 text-xs font-medium">{error}</p>
            </div>
          )}

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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        /* ── OTP tab ───────────────────────────────────────────────── */
        <div className="space-y-4">
          {otpStep === 'send' ? (
            <form onSubmit={(e) => { void handleOtpSend(e); }} className="space-y-4">
              <p className="text-xs text-gray-400 text-center">
                Enter your registered email or phone to receive a one-time code.
              </p>

              {/* Email / Phone sub-toggle */}
              <div className="flex bg-[#f0edf9] rounded-xl p-0.5">
                <button
                  type="button"
                  onClick={() => switchOtpMode('email')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-[10px] transition-all ${
                    otpMode === 'email'
                      ? 'bg-white shadow text-[#6D4AE0]'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" /> Email
                </button>
                <button
                  type="button"
                  onClick={() => switchOtpMode('phone')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-[10px] transition-all ${
                    otpMode === 'phone'
                      ? 'bg-white shadow text-[#6D4AE0]'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" /> Phone
                </button>
              </div>

              {otpMode === 'email' ? (
                <LoginInput
                  icon={<Mail className="w-4 h-4" />}
                  type="email"
                  aria-label="Email"
                  placeholder="you@example.com"
                  value={otpEmail}
                  onChange={(e) => setOtpEmail(e.target.value)}
                  required
                />
              ) : (
                <div
                  className="flex items-center bg-white rounded-2xl transition-all focus-within:ring-2 focus-within:ring-[#6D4AE0]/20 focus-within:border-[#6D4AE0]"
                  style={{ border: '1.5px solid #e3e0f0' }}
                >
                  <CountryCodeSelect value={otpCountry} onChange={setOtpCountry} />
                  <input
                    type="tel"
                    aria-label="Phone number"
                    placeholder="Mobile number"
                    value={otpPhone}
                    onChange={(e) => setOtpPhone(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    required
                    className="flex-1 px-3 py-3 text-sm outline-none bg-transparent text-gray-800 placeholder:text-gray-400"
                  />
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
                  <span className="text-red-400 text-sm" aria-hidden>⚠</span>
                  <p className="text-red-600 text-xs font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !otpIdentifier}
                className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99]"
                style={{
                  background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
                  boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
                }}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => { void handleOtpVerify(e); }} className="space-y-4">
              <div className="bg-[#f0edf9] rounded-xl px-4 py-3 text-center">
                <p className="text-xs text-gray-500">
                  Code sent to{' '}
                  <span className="font-semibold text-[#6D4AE0]">{otpIdentifier}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { setOtpStep('send'); setError(''); setInfo(''); }}
                  className="text-[10px] text-[#6D4AE0] hover:underline mt-0.5"
                >
                  Change
                </button>
              </div>

              <LoginInput
                icon={<KeyRound className="w-4 h-4" />}
                label="Enter 6-digit code"
                type="text"
                aria-label="6-digit OTP"
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />

              {info && (
                <div className="flex items-center gap-2 bg-[#f0edf9] border border-[#d4c8f5] rounded-xl px-3.5 py-2.5">
                  <span className="text-[#6D4AE0] text-sm" aria-hidden>✓</span>
                  <p className="text-[#6D4AE0] text-xs font-medium">{info}</p>
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
                  <span className="text-red-400 text-sm" aria-hidden>⚠</span>
                  <p className="text-red-600 text-xs font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otpCode.length !== 6}
                className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99]"
                style={{
                  background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
                  boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
                }}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Verifying…' : 'Verify & Sign In'}
              </button>

              <button
                type="button"
                onClick={() => { void handleOtpSend({ preventDefault: () => {} } as React.FormEvent); }}
                disabled={loading}
                className="w-full text-xs text-[#6D4AE0] hover:underline disabled:opacity-50 py-1"
              >
                Resend code
              </button>

              {IS_DEV && (
                <button
                  type="button"
                  disabled={loading}
                  className="w-full text-xs text-amber-500 hover:underline disabled:opacity-50 py-1"
                  onClick={async () => {
                    try {
                      const { data } = await api.auth.otpDevPeek(otpIdentifier);
                      setOtpCode(data.code);
                      setInfo(`[Dev] OTP auto-filled: ${data.code}`);
                    } catch {
                      setError('[Dev] No pending OTP found. Check API console.');
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

      {/* ── Social sign-in ───────────────────────────────────────────── */}
      <SocialRow
        providers={providers}
        onProviderClick={(p) => { void handleSocialLogin(p); }}
      />
    </LoginShell>
  );
}
