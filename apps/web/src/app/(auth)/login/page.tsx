'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, Lock, Eye, EyeOff, Loader2, KeyRound, Phone } from 'lucide-react';
import { api, setTokens, type OAuthProviders, type OAuthProvider } from '@/lib/api';
import { AuthShell, AuthPillInput, SocialRow, type OAuthProviderName } from '@/components/auth-shell';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';
const MOCK_TOKEN = 'mock-jwt-token-for-testing';

type Tab = 'password' | 'otp';
type OtpStep = 'send' | 'verify';

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('password');

  // Password fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // OTP fields
  const [otpIdentifier, setOtpIdentifier] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpStep, setOtpStep] = useState<OtpStep>('send');

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

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (MOCK_MODE) {
      if (email && password) {
        localStorage.setItem('cf_token', MOCK_TOKEN);
        router.push('/');
      } else {
        setError('Invalid email or password');
        setLoading(false);
      }
      return;
    }

    try {
      const { data } = await api.auth.login(email, password);
      setTokens(data.accessToken, data.refreshToken);
      router.push('/');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 401 ? 'Invalid email or password' : 'Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSend(e: React.FormEvent) {
    e.preventDefault();
    if (!otpIdentifier.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.auth.otpSend(otpIdentifier.trim());
      setOtpStep('verify');
      setInfo('Code sent! Check your email or phone.');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 400) {
        setError('Too many requests. Please wait a few minutes.');
      } else {
        setError('Could not send code. Please try again.');
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
      const { data } = await api.auth.otpVerify(otpIdentifier.trim(), otpCode.trim());
      setTokens(data.accessToken, data.refreshToken);
      router.push('/');
    } catch {
      setError('Invalid or expired code. Please try again.');
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

  return (
    <AuthShell
      brand="AI CreatorForce"
      title="Welcome Back"
      subtitle="Login to continue your journey"
      mascot="🙋‍♀️"
      footer={
        <>
          Don&rsquo;t have an account?{' '}
          <Link href="/register" className="text-[#7b5ec7] font-semibold hover:underline">
            Sign Up
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
          Sign in with Code
        </button>
      </div>

      {tab === 'password' ? (
        <form onSubmit={(e) => { void handlePasswordSubmit(e); }} className="space-y-4">
          <AuthPillInput
            icon={<User className="w-4 h-4" />}
            type="email"
            aria-label="Email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <div className="relative">
            <AuthPillInput
              icon={<Lock className="w-4 h-4" />}
              type={showPassword ? 'text' : 'password'}
              aria-label="Password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
          <div className="text-right">
            <button
              type="button"
              onClick={() => router.push('/forgot-password')}
              className="text-xs text-[#7b5ec7] hover:underline"
            >
              Forgot Password?
            </button>
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          {info && <p className="text-[#7b5ec7] text-xs text-center">{info}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Logging in…' : 'Login'}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          {otpStep === 'send' ? (
            <form onSubmit={(e) => { void handleOtpSend(e); }} className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Enter your registered email or phone number to receive a sign-in code.
              </p>
              <AuthPillInput
                icon={<Phone className="w-4 h-4" />}
                type="text"
                aria-label="Email or phone"
                placeholder="Email or phone number"
                value={otpIdentifier}
                onChange={(e) => setOtpIdentifier(e.target.value)}
                required
              />
              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
              <button
                type="submit"
                disabled={loading || !otpIdentifier.trim()}
                className="w-full py-3 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Sending…' : 'Send Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => { void handleOtpVerify(e); }} className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Code sent to{' '}
                <span className="font-medium text-gray-700">{otpIdentifier}</span>.{' '}
                <button
                  type="button"
                  onClick={() => { setOtpStep('send'); setError(''); setInfo(''); }}
                  className="text-[#7b5ec7] hover:underline text-xs"
                >
                  Change
                </button>
              </p>
              <AuthPillInput
                icon={<KeyRound className="w-4 h-4" />}
                type="text"
                aria-label="6-digit code"
                placeholder="6-digit code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
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
                {loading ? 'Verifying…' : 'Verify & Sign In'}
              </button>
              <button
                type="button"
                onClick={() => { void handleOtpSend({ preventDefault: () => {} } as React.FormEvent); }}
                disabled={loading}
                className="w-full text-xs text-[#7b5ec7] hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
            </form>
          )}
        </div>
      )}

      <SocialRow
        providers={providers}
        onProviderClick={(p) => { void handleSocialLogin(p); }}
      />
    </AuthShell>
  );
}
