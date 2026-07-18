'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { AuthShell, AuthPillInput } from '@/components/auth-shell';

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) { setError('Invalid reset link. Please request a new one.'); return; }
    setLoading(true);
    setError('');
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Reset link is invalid or has expired. Please request a new one.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brand="AI CreatorForce"
      title="Set New Password"
      subtitle="Choose a strong password for your account"
      mascot="🔐"
      footer={
        <Link href="/login" className="text-[#7b5ec7] font-semibold hover:underline">
          Back to login
        </Link>
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <p className="text-sm text-gray-700 text-center">Password updated successfully!</p>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="mt-2 py-2.5 px-6 bg-[#7a63cb] text-white rounded-full text-sm font-semibold hover:bg-[#6b54bd]"
          >
            Sign in
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          {!token && (
            <p className="text-red-500 text-sm text-center">Invalid or missing reset token. Please request a new password reset link.</p>
          )}
          <div className="relative">
            <AuthPillInput
              icon={<Lock className="w-4 h-4" />}
              type={showPassword ? 'text' : 'password'}
              aria-label="New password"
              placeholder="New password (min 8 chars)"
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
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !token || password.length < 8}
            className="w-full py-3 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[#7b5ec7]" /></div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
