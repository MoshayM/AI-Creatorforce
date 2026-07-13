'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api, setTokens, type OAuthProviders, type OAuthProvider } from '@/lib/api';
import { AuthShell, AuthPillInput, SocialRow, type OAuthProviderName } from '@/components/auth-shell';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';
const MOCK_TOKEN = 'mock-jwt-token-for-testing';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<OAuthProviders | undefined>(undefined);

  // Fetch which social providers are enabled
  useEffect(() => {
    if (MOCK_MODE) return;
    api.auth.providers()
      .then((r) => setProviders(r.data))
      .catch(() => {
        // Non-fatal: fall back to all-disabled appearance
        setProviders({ google: false, apple: false, facebook: false });
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (MOCK_MODE) {
      if (email && password) {
        localStorage.setItem('cf_token', MOCK_TOKEN);
        router.push('/projects');
      } else {
        setError('Invalid email or password');
        setLoading(false);
      }
      return;
    }

    try {
      const { data } = await api.auth.login(email, password);
      setTokens(data.accessToken, data.refreshToken);
      router.push('/projects');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        setError('Invalid email or password');
      } else {
        setError('Unable to connect. Please try again.');
      }
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
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
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
            onClick={() => setInfo('Password reset is coming soon — contact support to reset your password.')}
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

      <SocialRow
        providers={providers}
        onProviderClick={(p) => { void handleSocialLogin(p); }}
      />
    </AuthShell>
  );
}
