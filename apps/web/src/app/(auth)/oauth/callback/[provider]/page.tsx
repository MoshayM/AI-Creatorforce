'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { api, setTokens, type OAuthProvider } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';

type CallbackState =
  | { phase: 'verifying' }
  | { phase: 'link_required'; email: string; provider: string }
  | { phase: 'error'; message: string }
  | { phase: 'linked'; provider: string };

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  facebook: 'Facebook',
};

function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? p;
}

// Inner component — uses useSearchParams so must be inside Suspense
function OAuthCallbackInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const provider = (params['provider'] as string) ?? '';
  const code = searchParams.get('code') ?? '';
  const stateFromUrl = searchParams.get('state') ?? '';

  const [callbackState, setCallbackState] = useState<CallbackState>({ phase: 'verifying' });

  useEffect(() => {
    async function exchange() {
      // CSRF state check
      const storedState = sessionStorage.getItem('cf.oauth.state');
      sessionStorage.removeItem('cf.oauth.state');

      if (!code || !stateFromUrl) {
        setCallbackState({ phase: 'error', message: 'Missing code or state from OAuth provider. Please try again.' });
        return;
      }

      if (!storedState || storedState !== stateFromUrl) {
        setCallbackState({ phase: 'error', message: 'Security check failed (state mismatch). This may be a CSRF attempt. Please start the sign-in again.' });
        return;
      }

      try {
        const { data } = await api.auth.oauthCallback(provider as OAuthProvider, code, stateFromUrl);

        if (data.linked === true) {
          // Link flow completed successfully
          setCallbackState({ phase: 'linked', provider });
          router.replace(`/settings?linked=${encodeURIComponent(provider)}`);
          return;
        }

        if (data.accessToken && data.refreshToken) {
          setTokens(data.accessToken, data.refreshToken);
          router.replace('/projects');
          return;
        }

        setCallbackState({ phase: 'error', message: 'Unexpected response from server. Please try again.' });
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number; data?: { error?: string; email?: string } } };
        if (axiosErr?.response?.status === 409 && axiosErr.response.data?.error === 'LINK_REQUIRED') {
          const email = axiosErr.response.data.email ?? '';
          setCallbackState({ phase: 'link_required', email, provider });
          return;
        }
        const message =
          (axiosErr?.response?.data as Record<string, unknown>)?.['message'] as string
          ?? 'Sign-in failed. Please try again.';
        setCallbackState({ phase: 'error', message: typeof message === 'string' ? message : 'Sign-in failed. Please try again.' });
      }
    }

    void exchange();
    // Run once on mount only
  }, []);

  const label = providerLabel(provider);

  return (
    <AuthShell
      brand="AI CreatorForce"
      title="Signing you in"
      subtitle={`Completing ${label} authentication`}
      mascot="🔐"
      footer={
        <Link href="/login" className="text-[#7b5ec7] font-semibold hover:underline">
          Back to login
        </Link>
      }
    >
      <div className="py-6 flex flex-col items-center gap-4 text-center">
        {callbackState.phase === 'verifying' && (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-[#8b74d8]" />
            <p className="text-sm text-gray-600">Exchanging tokens with {label}…</p>
          </>
        )}

        {callbackState.phase === 'linked' && (
          <>
            <CheckCircle className="w-8 h-8 text-green-500" />
            <p className="text-sm text-gray-600">
              {label} account linked successfully. Redirecting to Settings…
            </p>
          </>
        )}

        {callbackState.phase === 'link_required' && (
          <>
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-medium text-gray-800">
              An account for {callbackState.email} already exists.
            </p>
            <p className="text-sm text-gray-600">
              Sign in with your existing method, then connect{' '}
              <span className="font-semibold">{providerLabel(callbackState.provider)}</span>{' '}
              from Settings.
            </p>
            <Link
              href="/login"
              className="mt-2 inline-block px-5 py-2.5 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full text-sm font-semibold shadow-lg shadow-[#8b74d8]/40 transition-colors"
            >
              Go to Login
            </Link>
          </>
        )}

        {callbackState.phase === 'error' && (
          <>
            <AlertCircle className="w-8 h-8 text-red-500" />
            <p className="text-sm text-red-600">{callbackState.message}</p>
            <Link
              href="/login"
              className="mt-2 inline-block px-5 py-2.5 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full text-sm font-semibold shadow-lg shadow-[#8b74d8]/40 transition-colors"
            >
              Try again
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <AuthShell
          brand="AI CreatorForce"
          title="Signing you in"
          subtitle="Please wait…"
          mascot="🔐"
          footer={null}
        >
          <div className="py-6 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#8b74d8]" />
          </div>
        </AuthShell>
      }
    >
      <OAuthCallbackInner />
    </Suspense>
  );
}
