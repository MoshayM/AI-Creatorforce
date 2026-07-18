'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Loader2, ArrowLeft, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { AuthShell, AuthPillInput } from '@/components/auth-shell';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.auth.forgotPassword(email.trim());
      setSent(true);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429 || status === 400) {
        setError('Too many requests. Please wait a few minutes.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      brand="AI CreatorForce"
      title="Forgot Password"
      subtitle="Enter your email to receive a reset link"
      mascot="🔑"
      footer={
        <Link href="/login" className="flex items-center gap-1 text-[#7b5ec7] font-semibold hover:underline">
          <ArrowLeft className="w-3 h-3" /> Back to login
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <p className="text-sm text-gray-700 text-center">
            If an account exists for <span className="font-semibold">{email}</span>, a reset link has been sent. Check your inbox.
          </p>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="mt-2 text-sm text-[#7b5ec7] hover:underline"
          >
            Return to login
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          <AuthPillInput
            icon={<Mail className="w-4 h-4" />}
            type="email"
            aria-label="Email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full py-3 bg-[#7a63cb] hover:bg-[#6b54bd] text-white rounded-full font-semibold shadow-lg shadow-[#8b74d8]/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Sending…' : 'Send Reset Link'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
