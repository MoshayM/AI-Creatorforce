'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, Loader2, ArrowLeft, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { ForgotPasswordShell, LoginInput } from '@/components/auth-shell';

const RESEND_COOLDOWN = 60; // seconds

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Countdown timer after send
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim() || cooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      await api.auth.forgotPassword(email.trim());
      setSent(true);
      setCooldown(RESEND_COOLDOWN);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429 || status === 400) {
        setError('Too many requests. Please wait a few minutes before trying again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <ForgotPasswordShell
      footer={
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-[#6D4AE0] font-semibold hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        /* ── Success state ─────────────────────────────────────────── */
        <div className="text-center">
          {/* Envelope animation */}
          <div className="flex justify-center mb-6">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
              style={{
                background: 'linear-gradient(135deg, #f0edf9 0%, #e2dbf5 100%)',
                boxShadow: '0 8px 32px rgba(109,74,224,0.18)',
              }}
            >
              📬
            </div>
          </div>

          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Check your inbox</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-1">
            We sent a reset link to
          </p>
          <p className="text-[#6D4AE0] font-semibold text-sm mb-6 break-all">{email}</p>

          {/* Tips */}
          <div
            className="rounded-2xl px-4 py-3.5 text-left space-y-2 mb-6"
            style={{ background: '#f5f2fd', border: '1.5px solid #e3ddf8' }}
          >
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Didn&apos;t receive it?</p>
            {[
              "Check your spam or junk folder",
              "Make sure you typed the right address",
              "Allow a minute for delivery",
            ].map((tip) => (
              <div key={tip} className="flex items-start gap-2">
                <span className="text-[#6D4AE0] mt-0.5 text-xs shrink-0">•</span>
                <p className="text-gray-500 text-xs">{tip}</p>
              </div>
            ))}
          </div>

          {/* Resend */}
          <button
            type="button"
            onClick={() => { void submit(); }}
            disabled={loading || cooldown > 0}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:cursor-not-allowed"
            style={
              cooldown > 0
                ? { background: '#f0edf9', color: '#9d8adf', border: '1.5px solid #e3ddf8' }
                : {
                    background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
                    color: '#fff',
                    boxShadow: '0 4px 20px rgba(109,74,224,0.30)',
                  }
            }
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Resending…</>
            ) : cooldown > 0 ? (
              <>Resend in {cooldown}s</>
            ) : (
              <><Send className="w-4 h-4" /> Resend email</>
            )}
          </button>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5 mt-4">
              <span className="text-red-400 text-sm" aria-hidden>⚠</span>
              <p className="text-red-600 text-xs font-medium">{error}</p>
            </div>
          )}
        </div>
      ) : (
        /* ── Email form ────────────────────────────────────────────── */
        <>
          <div className="mb-8">
            <h2 className="text-[1.9rem] font-extrabold text-gray-900 leading-tight mb-1.5">Forgot password?</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Enter the email linked to your account and we&apos;ll send you a secure reset link.
            </p>
          </div>

          <form onSubmit={(e) => { void submit(e); }} className="space-y-4">
            <LoginInput
              icon={<Mail className="w-4 h-4" />}
              label="Email address"
              type="email"
              aria-label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
                <span className="text-red-400 text-sm" aria-hidden>⚠</span>
                <p className="text-red-600 text-xs font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99]"
              style={{
                background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
                boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
              }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        </>
      )}
    </ForgotPasswordShell>
  );
}
