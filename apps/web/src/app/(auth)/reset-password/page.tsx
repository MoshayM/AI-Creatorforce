'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { ResetPasswordShell, LoginInput } from '@/components/auth-shell';

// ── Password strength helpers ─────────────────────────────────────────────────

type StrengthLevel = 0 | 1 | 2 | 3 | 4;

const REQUIREMENTS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'Uppercase letter',       test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter',       test: (p: string) => /[a-z]/.test(p) },
  { label: 'Number',                 test: (p: string) => /\d/.test(p) },
  { label: 'Special character',      test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function getStrength(password: string): StrengthLevel {
  const met = REQUIREMENTS.filter((r) => r.test(password)).length;
  if (met <= 1) return 0;
  if (met === 2) return 1;
  if (met === 3) return 2;
  if (met === 4) return 3;
  return 4;
}

const STRENGTH_META: Record<StrengthLevel, { label: string; color: string; bars: number }> = {
  0: { label: 'Too weak',  color: '#ef4444', bars: 1 },
  1: { label: 'Weak',      color: '#f97316', bars: 2 },
  2: { label: 'Fair',      color: '#eab308', bars: 3 },
  3: { label: 'Good',      color: '#22c55e', bars: 4 },
  4: { label: 'Strong',    color: '#16a34a', bars: 5 },
};

function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const level = getStrength(password);
  const meta = STRENGTH_META[level];

  return (
    <div className="space-y-2.5 mt-1">
      {/* Bar */}
      <div className="flex gap-1" aria-label={`Password strength: ${meta.label}`} role="meter">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex-1 h-1.5 rounded-full transition-all duration-300"
            style={{ background: i <= meta.bars ? meta.color : '#e5e7eb' }}
          />
        ))}
      </div>

      {/* Label + requirements */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[10px] text-gray-400">{REQUIREMENTS.filter((r) => r.test(password)).length}/{REQUIREMENTS.length}</span>
      </div>

      {/* Checklist — only show unmet items to reduce noise */}
      {level < 4 && (
        <div className="space-y-1">
          {REQUIREMENTS.map((r) => {
            const met = r.test(password);
            return (
              <div key={r.label} className="flex items-center gap-2">
                <span className={`text-xs shrink-0 ${met ? 'text-green-500' : 'text-gray-300'}`} aria-hidden>
                  {met ? '✓' : '○'}
                </span>
                <span className={`text-xs ${met ? 'text-green-600 line-through' : 'text-gray-400'}`}>{r.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const strength = getStrength(password);
  const canSubmit = !!token && password.length >= 8 && !loading;

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
    <ResetPasswordShell
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
      {done ? (
        /* ── Success state ─────────────────────────────────────────── */
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
              style={{
                background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                boxShadow: '0 8px 32px rgba(34,197,94,0.18)',
              }}
            >
              ✅
            </div>
          </div>

          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Password updated!</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            Your new password is set. Sign in to get back to creating.
          </p>

          <button
            type="button"
            onClick={() => router.push('/login')}
            className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99]"
            style={{
              background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
              boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
            }}
          >
            Sign in to Blueforce
          </button>
        </div>
      ) : !token ? (
        /* ── Invalid / missing token ───────────────────────────────── */
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl"
              style={{ background: '#fef2f2', boxShadow: '0 8px 32px rgba(239,68,68,0.12)' }}
            >
              🔗
            </div>
          </div>

          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Link expired or invalid</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-8">
            This password reset link is missing, expired, or has already been used. Reset links are valid for 1 hour.
          </p>

          <Link
            href="/forgot-password"
            className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99]"
            style={{
              background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
              boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
            }}
          >
            Request a new link
          </Link>
        </div>
      ) : (
        /* ── Password form ─────────────────────────────────────────── */
        <>
          <div className="mb-8">
            <h2 className="text-[1.9rem] font-extrabold text-gray-900 leading-tight mb-1.5">Set new password</h2>
            <p className="text-gray-400 text-sm">Choose a strong password to secure your account.</p>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
            <div>
              <LoginInput
                icon={<Lock className="w-4 h-4" />}
                label="New password"
                type={showPassword ? 'text' : 'password'}
                aria-label="New password"
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
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
              <StrengthMeter password={password} />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl px-3.5 py-3">
                <span className="text-red-400 text-sm mt-0.5 shrink-0" aria-hidden>⚠</span>
                <div>
                  <p className="text-red-600 text-xs font-medium">{error}</p>
                  {error.toLowerCase().includes('expired') && (
                    <Link href="/forgot-password" className="text-[#6D4AE0] text-xs hover:underline mt-1 inline-block">
                      Request a new link →
                    </Link>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3.5 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99]"
              style={{
                background:
                  strength >= 2
                    ? 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)'
                    : '#9d8adf',
                boxShadow: strength >= 2 ? '0 4px 20px rgba(109,74,224,0.35)' : 'none',
              }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Updating password…' : 'Update password'}
            </button>
          </form>
        </>
      )}
    </ResetPasswordShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#faf9ff]">
          <Loader2 className="w-6 h-6 animate-spin text-[#6D4AE0]" />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
