'use client';
import React from 'react';

// ─── Legacy shell — used by register / forgot-password / reset-password ───────

export function AuthShell({
  brand,
  title,
  subtitle,
  mascot,
  children,
  footer,
}: {
  brand: string;
  title: string;
  subtitle: string;
  mascot: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#b3a2e8] relative overflow-hidden py-10 px-4">
      <div className="absolute top-16 left-[12%] w-24 h-10 bg-white/80 rounded-full blur-[1px]" />
      <div className="absolute top-24 left-[16%] w-14 h-8 bg-white/70 rounded-full" />
      <div className="absolute top-32 right-[14%] w-28 h-11 bg-white/80 rounded-full blur-[1px]" />
      <div className="absolute bottom-24 left-[8%] w-40 h-40 bg-[#9d8adf]/60 rounded-full" />
      <div className="absolute bottom-10 right-[6%] w-56 h-56 bg-[#a794e4]/50 rounded-full" />

      <div className="relative w-full max-w-md bg-[#f7f4fd] rounded-[3rem] shadow-2xl px-6 pt-10 pb-8">
        <p className="text-center text-[11px] font-semibold tracking-[0.25em] uppercase text-[#6b54bd] mb-3">{brand}</p>
        <div className="text-center">
          <span className="text-lg" aria-hidden>💜</span>
          <h1 className="text-3xl font-extrabold text-[#7b5ec7] mt-1">
            <span className="text-[#e8c14d] mr-2" aria-hidden>✦</span>
            {title}
            <span className="text-[#e8c14d] ml-2" aria-hidden>✦</span>
          </h1>
          <p className="text-sm text-gray-600 mt-2">{subtitle}</p>
        </div>
        <div className="relative z-10 flex justify-center -mb-9 mt-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-b from-[#cbbcf2] to-[#a48fe0] shadow-lg flex items-center justify-center text-5xl select-none" aria-hidden>
            {mascot}
          </div>
        </div>
        <div className="bg-white rounded-[2rem] shadow-xl px-5 pb-6 pt-14">
          {children}
        </div>
        <div className="text-center text-sm text-gray-600 mt-5">{footer}</div>
      </div>
    </div>
  );
}

export function AuthPillInput({
  icon,
  ...inputProps
}: { icon: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-center bg-white border border-[#e4ddf6] rounded-full shadow-[inset_0_1px_3px_rgba(123,94,199,0.08)] pr-3 focus-within:ring-2 focus-within:ring-[#a48fe0]">
      <span className="w-10 h-10 m-1 rounded-full bg-[#8b74d8] text-white flex items-center justify-center shrink-0">
        {icon}
      </span>
      <input
        {...inputProps}
        className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
      />
    </div>
  );
}

// ─── Split-screen login shell ──────────────────────────────────────────────────

const LOGIN_FEATURES = [
  { icon: '🧠', text: 'AI Script Writing' },
  { icon: '📈', text: 'SEO Intelligence' },
  { icon: '🎯', text: 'Trend Discovery' },
  { icon: '🚀', text: 'Smart Publishing' },
  { icon: '📊', text: 'Deep Analytics' },
  { icon: '✅', text: 'Compliance Check' },
];

const LOGIN_STATS = [
  { value: '10K+', label: 'Creators' },
  { value: '500K+', label: 'Videos' },
  { value: '4.8★', label: 'Rating' },
];

export function LoginShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* ── Left: Brand panel ──────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[58%] xl:w-[60%] relative overflow-hidden flex-col justify-between px-14 xl:px-20 py-14"
        style={{ background: 'linear-gradient(145deg, #4f2ec4 0%, #6D4AE0 55%, #7c5ae8 100%)' }}
      >
        {/* Ambient glow orbs */}
        <div
          className="absolute -top-48 -left-32 w-[520px] h-[520px] rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', filter: 'blur(90px)' }}
        />
        <div
          className="absolute top-1/2 -right-20 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'rgba(160,120,255,0.30)', filter: 'blur(70px)' }}
        />
        <div
          className="absolute -bottom-40 left-1/3 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'rgba(70,40,190,0.55)', filter: 'blur(80px)' }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}
          >
            🎬
          </div>
          <div>
            <div className="text-white font-extrabold text-xl tracking-tight leading-none">AI CreatorForce</div>
            <div className="text-white/50 text-xs mt-0.5">YouTube Growth Intelligence</div>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10">
          <div
            className="inline-flex items-center gap-2 text-white/80 text-xs font-semibold px-4 py-1.5 rounded-full mb-8"
            style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            Powered by Claude · GPT-4o · Gemini
          </div>

          <h1 className="text-5xl xl:text-[3.4rem] font-extrabold text-white leading-[1.1] mb-5">
            Turn Ideas<br />
            Into{' '}
            <span
              style={{
                WebkitTextFillColor: 'transparent',
                WebkitBackgroundClip: 'text',
                backgroundImage: 'linear-gradient(90deg, #f0c14d 0%, #ffd966 100%)',
                backgroundClip: 'text',
              }}
            >
              Viral
            </span>
            {' '}Videos
          </h1>

          <p className="text-white/65 text-[1.05rem] leading-relaxed max-w-sm mb-10">
            Research trends, write scripts, optimize SEO, and publish — your AI content team, available 24/7.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2.5 mb-12">
            {LOGIN_FEATURES.map((f) => (
              <span
                key={f.text}
                className="inline-flex items-center gap-1.5 text-sm text-white/85 font-medium px-3.5 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.11)', backdropFilter: 'blur(8px)' }}
              >
                <span aria-hidden>{f.icon}</span> {f.text}
              </span>
            ))}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-8">
            {LOGIN_STATS.map((s, i) => (
              <React.Fragment key={s.label}>
                {i > 0 && <div className="w-px h-10 bg-white/20" />}
                <div>
                  <div className="text-2xl font-extrabold text-white">{s.value}</div>
                  <div className="text-white/50 text-xs mt-0.5">{s.label}</div>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div
          className="relative z-10 rounded-2xl p-5"
          style={{
            background: 'rgba(255,255,255,0.10)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <div className="flex gap-0.5 mb-3" aria-label="5 stars">
            {[...Array(5)].map((_, i) => (
              <span key={i} className="text-[#f0c14d] text-sm" aria-hidden>★</span>
            ))}
          </div>
          <p className="text-white/80 text-sm leading-relaxed mb-4">
            &ldquo;CreatorForce helped me grow from 5K to 150K subscribers in 6 months. The AI scripts are genuinely better than what I was writing myself.&rdquo;
          </p>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#f0c14d] to-[#f5a623] flex items-center justify-center text-sm font-bold text-[#6D4AE0] shrink-0">
              M
            </div>
            <div>
              <div className="text-white text-sm font-semibold leading-none mb-0.5">Marcus Chen</div>
              <div className="text-white/50 text-xs">Tech Creator · 150K subscribers</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Form panel ──────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-[#faf9ff] px-6 sm:px-10 py-12 overflow-y-auto">
        <div className="w-full max-w-[370px]">
          {/* Mobile brand */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-[#6D4AE0] flex items-center justify-center text-lg" aria-hidden>
              🎬
            </div>
            <span className="text-[#6D4AE0] font-bold text-lg">AI CreatorForce</span>
          </div>

          <div className="mb-8">
            <h2 className="text-[1.9rem] font-extrabold text-gray-900 leading-tight mb-1.5">Welcome back</h2>
            <p className="text-gray-400 text-sm">Sign in to continue to your dashboard</p>
          </div>

          {children}

          <p className="text-center text-sm text-gray-400 mt-8">{footer}</p>
        </div>
      </div>
    </div>
  );
}

/** Clean rectangular input for the login page */
export function LoginInput({
  icon,
  label,
  rightElement,
  ...inputProps
}: {
  icon?: React.ReactNode;
  label?: string;
  rightElement?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      {label && (
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      )}
      <div
        className="flex items-center bg-white rounded-2xl transition-all focus-within:ring-2 focus-within:ring-[#6D4AE0]/20 focus-within:border-[#6D4AE0]"
        style={{ border: '1.5px solid #e3e0f0' }}
      >
        {icon && (
          <span className="pl-3.5 text-gray-400 shrink-0">{icon}</span>
        )}
        <input
          {...inputProps}
          className="flex-1 min-w-0 bg-transparent px-3 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
        />
        {rightElement && (
          <span className="pr-2 shrink-0">{rightElement}</span>
        )}
      </div>
    </div>
  );
}

// ─── Split-screen register shell ──────────────────────────────────────────────

const REGISTER_PERKS = [
  { icon: '🧠', text: 'AI video ideas & script writing' },
  { icon: '📈', text: 'SEO optimization & thumbnail copy' },
  { icon: '🎯', text: 'Trend & competitor discovery' },
  { icon: '🚀', text: 'One-click YouTube publishing' },
  { icon: '📊', text: 'Channel analytics dashboard' },
  { icon: '✅', text: 'Compliance & monetization check' },
];

export function RegisterShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* ── Left: Brand panel ──────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[52%] xl:w-[54%] relative overflow-hidden flex-col justify-between px-14 xl:px-18 py-14"
        style={{ background: 'linear-gradient(145deg, #4f2ec4 0%, #6D4AE0 55%, #7c5ae8 100%)' }}
      >
        {/* Ambient orbs */}
        <div
          className="absolute -top-40 -left-28 w-[480px] h-[480px] rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', filter: 'blur(90px)' }}
        />
        <div
          className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'rgba(160,120,255,0.28)', filter: 'blur(70px)' }}
        />
        <div
          className="absolute top-1/2 left-1/4 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'rgba(70,40,190,0.45)', filter: 'blur(80px)' }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
            style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}
          >
            🎬
          </div>
          <div>
            <div className="text-white font-extrabold text-xl tracking-tight leading-none">AI CreatorForce</div>
            <div className="text-white/50 text-xs mt-0.5">YouTube Growth Intelligence</div>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10">
          <div
            className="inline-flex items-center gap-2 text-white/80 text-xs font-semibold px-4 py-1.5 rounded-full mb-8"
            style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            Free forever plan · No credit card needed
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-[1.1] mb-4">
            Start Your<br />
            <span
              style={{
                WebkitTextFillColor: 'transparent',
                WebkitBackgroundClip: 'text',
                backgroundImage: 'linear-gradient(90deg, #f0c14d 0%, #ffd966 100%)',
                backgroundClip: 'text',
              }}
            >
              Creator Journey
            </span>
            <br />Today
          </h1>

          <p className="text-white/65 text-base leading-relaxed max-w-xs mb-8">
            Everything you need to research, create, and grow your YouTube channel — powered by AI.
          </p>

          {/* Perks list */}
          <div className="space-y-3 mb-10">
            {REGISTER_PERKS.map((p) => (
              <div key={p.text} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0"
                  style={{ background: 'rgba(255,255,255,0.13)', backdropFilter: 'blur(8px)' }}
                >
                  {p.icon}
                </div>
                <span className="text-white/85 text-sm font-medium">{p.text}</span>
              </div>
            ))}
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap gap-3">
            {[
              { icon: '🔒', text: 'SOC 2 compliant' },
              { icon: '⚡', text: 'Setup in 2 minutes' },
              { icon: '🎁', text: 'Free plan forever' },
            ].map((b) => (
              <span
                key={b.text}
                className="inline-flex items-center gap-1.5 text-xs text-white/75 font-medium px-3.5 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(8px)' }}
              >
                <span aria-hidden>{b.icon}</span> {b.text}
              </span>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div
          className="relative z-10 rounded-2xl p-5"
          style={{
            background: 'rgba(255,255,255,0.10)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <div className="flex gap-0.5 mb-3" aria-label="5 stars">
            {[...Array(5)].map((_, i) => (
              <span key={i} className="text-[#f0c14d] text-sm" aria-hidden>★</span>
            ))}
          </div>
          <p className="text-white/80 text-sm leading-relaxed mb-4">
            &ldquo;I was spending 20+ hours a week on content research. CreatorForce cut that to under 2 hours. The trend discovery alone is worth it.&rdquo;
          </p>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#f0c14d] to-[#f5a623] flex items-center justify-center text-sm font-bold text-[#6D4AE0] shrink-0">
              S
            </div>
            <div>
              <div className="text-white text-sm font-semibold leading-none mb-0.5">Sofia Martinez</div>
              <div className="text-white/50 text-xs">Lifestyle Creator · 85K subscribers</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Form panel ──────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-[#faf9ff] px-6 sm:px-10 py-10 overflow-y-auto">
        <div className="w-full max-w-[380px]">
          {/* Mobile brand */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-[#6D4AE0] flex items-center justify-center text-lg" aria-hidden>
              🎬
            </div>
            <span className="text-[#6D4AE0] font-bold text-lg">AI CreatorForce</span>
          </div>

          <div className="mb-7">
            <h2 className="text-[1.75rem] font-extrabold text-gray-900 leading-tight mb-1.5">Create your account</h2>
            <p className="text-gray-400 text-sm">Free forever · No credit card required</p>
          </div>

          {children}

          <p className="text-center text-sm text-gray-400 mt-7">{footer}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Forgot-password shell ────────────────────────────────────────────────────

const RECOVERY_STEPS = [
  {
    n: '1',
    icon: '📧',
    title: 'Enter your email',
    desc: "We'll verify it's registered with AI CreatorForce",
  },
  {
    n: '2',
    icon: '📬',
    title: 'Check your inbox',
    desc: 'Look for an email from AI CreatorForce (check spam too)',
  },
  {
    n: '3',
    icon: '🔑',
    title: 'Set a new password',
    desc: 'Click the secure link and choose a strong password',
  },
];

export function ForgotPasswordShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[52%] xl:w-[54%] relative overflow-hidden flex-col justify-between px-14 xl:px-20 py-14"
        style={{ background: 'linear-gradient(145deg, #4f2ec4 0%, #6D4AE0 55%, #7c5ae8 100%)' }}
      >
        <div className="absolute -top-40 -left-28 w-[480px] h-[480px] rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.06)', filter: 'blur(90px)' }} />
        <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'rgba(160,120,255,0.28)', filter: 'blur(70px)' }} />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}>
            🎬
          </div>
          <div>
            <div className="text-white font-extrabold text-xl tracking-tight leading-none">AI CreatorForce</div>
            <div className="text-white/50 text-xs mt-0.5">YouTube Growth Intelligence</div>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10">
          {/* Lock icon */}
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center text-3xl mb-8" style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)' }}>
            🔒
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-[1.1] mb-4">
            Account<br />
            <span style={{ WebkitTextFillColor: 'transparent', WebkitBackgroundClip: 'text', backgroundImage: 'linear-gradient(90deg, #f0c14d 0%, #ffd966 100%)', backgroundClip: 'text' }}>
              Recovery
            </span>
          </h1>
          <p className="text-white/65 text-base leading-relaxed max-w-xs mb-10">
            Regain access to your account in three simple steps. Your data is safe and waiting for you.
          </p>

          {/* Steps */}
          <div className="space-y-5">
            {RECOVERY_STEPS.map((s, i) => (
              <div key={s.n} className="flex items-start gap-4">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-base font-extrabold text-[#6D4AE0] bg-[#f0c14d] shrink-0">
                    {s.n}
                  </div>
                  {i < RECOVERY_STEPS.length - 1 && (
                    <div className="w-px h-5 mt-1 bg-white/20" />
                  )}
                </div>
                <div className="pt-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span aria-hidden>{s.icon}</span>
                    <span className="text-white font-semibold text-sm">{s.title}</span>
                  </div>
                  <p className="text-white/55 text-xs leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Security note */}
        <div className="relative z-10 rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <span className="text-xl shrink-0 mt-0.5" aria-hidden>🛡️</span>
          <div>
            <div className="text-white text-sm font-semibold mb-0.5">Secure reset link</div>
            <p className="text-white/60 text-xs leading-relaxed">Reset links expire after 1 hour and can only be used once. We&apos;ll never ask for your password over email.</p>
          </div>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-[#faf9ff] px-6 sm:px-10 py-12 overflow-y-auto">
        <div className="w-full max-w-[370px]">
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-[#6D4AE0] flex items-center justify-center text-lg" aria-hidden>🎬</div>
            <span className="text-[#6D4AE0] font-bold text-lg">AI CreatorForce</span>
          </div>
          {children}
          <p className="text-center text-sm text-gray-400 mt-8">{footer}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Reset-password shell ─────────────────────────────────────────────────────

const PASSWORD_TIPS = [
  { icon: '📏', text: 'At least 8 characters long' },
  { icon: '🔠', text: 'Mix uppercase and lowercase letters' },
  { icon: '🔢', text: 'Include at least one number' },
  { icon: '✳️', text: 'Add a special character (!@#$%^&*)' },
  { icon: '🚫', text: "Don't reuse a previous password" },
];

export function ResetPasswordShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[52%] xl:w-[54%] relative overflow-hidden flex-col justify-between px-14 xl:px-20 py-14"
        style={{ background: 'linear-gradient(145deg, #4f2ec4 0%, #6D4AE0 55%, #7c5ae8 100%)' }}
      >
        <div className="absolute -top-40 -left-28 w-[480px] h-[480px] rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.06)', filter: 'blur(90px)' }} />
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full pointer-events-none" style={{ background: 'rgba(160,120,255,0.28)', filter: 'blur(70px)' }} />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}>
            🎬
          </div>
          <div>
            <div className="text-white font-extrabold text-xl tracking-tight leading-none">AI CreatorForce</div>
            <div className="text-white/50 text-xs mt-0.5">YouTube Growth Intelligence</div>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center text-3xl mb-8" style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)' }}>
            🛡️
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-[1.1] mb-4">
            Almost<br />
            <span style={{ WebkitTextFillColor: 'transparent', WebkitBackgroundClip: 'text', backgroundImage: 'linear-gradient(90deg, #f0c14d 0%, #ffd966 100%)', backgroundClip: 'text' }}>
              There
            </span>
          </h1>
          <p className="text-white/65 text-base leading-relaxed max-w-xs mb-10">
            Create a strong new password to keep your creator account secure.
          </p>

          {/* Tips */}
          <div className="mb-10">
            <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">Strong password tips</p>
            <div className="space-y-3.5">
              {PASSWORD_TIPS.map((t) => (
                <div key={t.text} className="flex items-center gap-3">
                  <span className="text-base shrink-0" aria-hidden>{t.icon}</span>
                  <span className="text-white/80 text-sm">{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pro tip */}
        <div className="relative z-10 rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <span className="text-xl shrink-0 mt-0.5" aria-hidden>💡</span>
          <div>
            <div className="text-white text-sm font-semibold mb-0.5">Pro tip</div>
            <p className="text-white/60 text-xs leading-relaxed">Use a passphrase like &ldquo;Coffee!Makes3Videos&rdquo; — easy to remember, hard to crack.</p>
          </div>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-[#faf9ff] px-6 sm:px-10 py-12 overflow-y-auto">
        <div className="w-full max-w-[370px]">
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-[#6D4AE0] flex items-center justify-center text-lg" aria-hidden>🎬</div>
            <span className="text-[#6D4AE0] font-bold text-lg">AI CreatorForce</span>
          </div>
          {children}
          <p className="text-center text-sm text-gray-400 mt-8">{footer}</p>
        </div>
      </div>
    </div>
  );
}

// ─── OAuth callback shell — Short Studio showcase ────────────────────────────

const SHORT_FEATURES = [
  { icon: '✂️', text: 'AI Auto-Edit' },
  { icon: '📱', text: 'Vertical Format' },
  { icon: '🎯', text: 'Hook Generator' },
  { icon: '🎵', text: 'Music Sync' },
  { icon: '💬', text: 'Auto Captions' },
  { icon: '🚀', text: 'Multi-Platform' },
];

const MOCK_SHORTS = [
  {
    bg: 'linear-gradient(175deg, #7c3aed 0%, #3b0764 100%)',
    emoji: '🤖',
    title: '5 AI Hacks',
    views: '2.3M',
    badge: '#a78bfa',
  },
  {
    bg: 'linear-gradient(175deg, #e11d48 0%, #7f1d1d 100%)',
    emoji: '😱',
    title: 'Wait for it',
    views: '4.1M',
    badge: '#fca5a5',
  },
  {
    bg: 'linear-gradient(175deg, #0891b2 0%, #1e3a8a 100%)',
    emoji: '📈',
    title: 'Grow to 100K',
    views: '1.8M',
    badge: '#7dd3fc',
  },
];

export function OAuthCallbackShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex">
      {/* ── Left: Short Studio showcase ────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[55%] xl:w-[56%] relative overflow-hidden flex-col justify-between px-14 xl:px-20 py-14"
        style={{ background: 'linear-gradient(145deg, #4f2ec4 0%, #6D4AE0 55%, #7c5ae8 100%)' }}
      >
        {/* Orbs */}
        <div className="absolute -top-40 -left-28 w-[480px] h-[480px] rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.06)', filter: 'blur(90px)' }} />
        <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'rgba(160,120,255,0.30)', filter: 'blur(70px)' }} />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(12px)' }}>
            🎬
          </div>
          <div>
            <div className="text-white font-extrabold text-xl tracking-tight leading-none">AI CreatorForce</div>
            <div className="text-white/50 text-xs mt-0.5">YouTube Growth Intelligence</div>
          </div>
        </div>

        {/* Hero — Short Studio */}
        <div className="relative z-10">
          {/* NEW badge */}
          <div className="inline-flex items-center gap-2 mb-5">
            <span
              className="text-[10px] font-extrabold tracking-widest uppercase px-2.5 py-1 rounded-full"
              style={{ background: '#f0c14d', color: '#3b1f00' }}
            >
              NEW
            </span>
            <span className="text-white/60 text-xs font-medium">Now live in your dashboard</span>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
              style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
            >
              ✂️
            </div>
            <div>
              <div className="text-white font-extrabold text-2xl leading-tight">Short Studio</div>
              <div className="text-white/50 text-xs">AI-powered short-form video creation</div>
            </div>
          </div>

          <h1 className="text-4xl xl:text-[2.8rem] font-extrabold text-white leading-[1.1] mb-4">
            Create Viral<br />
            <span style={{ WebkitTextFillColor: 'transparent', WebkitBackgroundClip: 'text', backgroundImage: 'linear-gradient(90deg, #f0c14d 0%, #ffd966 100%)', backgroundClip: 'text' }}>
              Shorts in Minutes
            </span>
          </h1>
          <p className="text-white/60 text-sm leading-relaxed max-w-xs mb-8">
            From idea to published short — AI handles scripting, editing, captions, and multi-platform publishing for you.
          </p>

          {/* Mock video cards */}
          <div className="flex gap-3 mb-8">
            {MOCK_SHORTS.map((s) => (
              <div
                key={s.title}
                className="rounded-2xl overflow-hidden flex-1 flex flex-col justify-between relative"
                style={{ background: s.bg, aspectRatio: '9/16', maxWidth: 96 }}
              >
                {/* Top bar */}
                <div className="flex items-center justify-between px-2 pt-2">
                  <div className="w-4 h-0.5 rounded-full bg-white/60" />
                  <div
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: s.badge, color: '#1e0040' }}
                  >
                    #shorts
                  </div>
                </div>
                {/* Emoji */}
                <div className="flex-1 flex items-center justify-center text-3xl" aria-hidden>
                  {s.emoji}
                </div>
                {/* Bottom */}
                <div className="px-2 pb-2.5">
                  <p className="text-white text-[10px] font-bold leading-tight mb-1 drop-shadow">{s.title}</p>
                  <div className="flex items-center gap-1 text-white/70 text-[9px]">
                    <span>▶</span>
                    <span>{s.views}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-3 gap-2">
            {SHORT_FEATURES.map((f) => (
              <div
                key={f.text}
                className="flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl text-center"
                style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(8px)' }}
              >
                <span className="text-lg" aria-hidden>{f.icon}</span>
                <span className="text-white/80 text-[10px] font-semibold leading-tight">{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="relative z-10 flex items-center gap-6">
          {[
            { value: '60s', label: 'Avg. creation time' },
            { value: '10M+', label: 'Shorts published' },
            { value: '3×', label: 'More views with AI hooks' },
          ].map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <div className="w-px h-8 bg-white/20" />}
              <div>
                <div className="text-xl font-extrabold text-white">{s.value}</div>
                <div className="text-white/45 text-[10px] mt-0.5">{s.label}</div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Right: Status panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-[#faf9ff] px-6 sm:px-10 py-12 overflow-y-auto">
        <div className="w-full max-w-[360px]">
          {/* Mobile brand */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-[#6D4AE0] flex items-center justify-center text-lg" aria-hidden>🎬</div>
            <span className="text-[#6D4AE0] font-bold text-lg">AI CreatorForce</span>
          </div>

          {children}

          <p className="text-center text-sm text-gray-400 mt-8">{footer}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Social sign-in row (shared) ──────────────────────────────────────────────

export type OAuthProviderName = 'google' | 'apple' | 'facebook';

const SOCIALS: Array<{ name: string; key: OAuthProviderName; svg: React.ReactNode }> = [
  {
    name: 'Google',
    key: 'google',
    svg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
        <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z" />
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.1 0-5.8-2.1-6.8-5H1.3v3C3.3 21.3 7.3 24 12 24z" />
        <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4v-3H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z" />
        <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C16.9 1 14.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c1-2.9 3.7-4.9 6.8-4.9z" />
      </svg>
    ),
  },
  {
    name: 'Apple',
    key: 'apple',
    svg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-gray-900" aria-hidden>
        <path d="M16.4 12.9c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.7c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-3.7zM14 5.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
      </svg>
    ),
  },
  {
    name: 'Facebook',
    key: 'facebook',
    svg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#1877F2]" aria-hidden>
        <path d="M24 12c0-6.6-5.4-12-12-12S0 5.4 0 12c0 6 4.4 11 10.1 11.9v-8.4H7.1V12h3v-2.6c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4C19.6 23 24 18 24 12z" />
      </svg>
    ),
  },
];

export function SocialRow({
  providers,
  onProviderClick,
}: {
  providers?: Record<OAuthProviderName, boolean>;
  onProviderClick?: (provider: OAuthProviderName) => void;
}) {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="flex-1 h-px bg-gray-200" />
        or continue with
        <span className="flex-1 h-px bg-gray-200" />
      </div>
      <div className="flex justify-center gap-3 mt-3">
        {SOCIALS.map((s) => {
          const enabled = providers ? providers[s.key] : false;
          return (
            <button
              key={s.name}
              type="button"
              disabled={!enabled}
              onClick={enabled && onProviderClick ? () => onProviderClick(s.key) : undefined}
              title={enabled ? `Continue with ${s.name}` : `${s.name} sign-in coming soon`}
              aria-label={enabled ? `${s.name} sign-in` : `${s.name} sign-in (coming soon)`}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                enabled
                  ? 'bg-white shadow-md hover:shadow-lg cursor-pointer hover:-translate-y-0.5'
                  : 'bg-white/70 shadow cursor-not-allowed opacity-60'
              }`}
              style={{ border: '1.5px solid #ede9f8' }}
            >
              {s.svg}
            </button>
          );
        })}
      </div>
    </div>
  );
}
