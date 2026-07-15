import Link from 'next/link';
import {
  Zap,
  Clapperboard,
  Film,
  Workflow,
  ShieldCheck,
  Wallet,
  Gift,
  Youtube,
  Cpu,
  Scissors,
  Upload,
  CheckCircle2,
} from 'lucide-react';
import { MobileNav } from './_components/MobileNav';
import { DownloadButtons } from './_components/DownloadButtons';

// ── Feature data ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Clapperboard,
    title: 'Channel-first Shorts Studio',
    description:
      'Connect your YouTube channel, import long-form videos, and let AI find the best clips, generate captions, and queue publish-ready Shorts.',
  },
  {
    icon: Film,
    title: 'Multi-track Video Editor',
    description:
      'Full timeline editor with effects, transitions, captions overlay, and export to MP4 or WebM — no desktop software needed.',
  },
  {
    icon: Workflow,
    title: 'Per-channel Automation',
    description:
      'Set up channel-level rules: auto-import new uploads, run AI analysis, and trigger publish flows with AI suggestions on schedule.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance-gated Publishing',
    description:
      'Every piece of content passes the Compliance Intelligence Engine before it can be published — copyright, monetization, and policy checks built in.',
  },
  {
    icon: Wallet,
    title: 'Wallet & Credits',
    description:
      'Buy AI credits to power generation, track spend per project, and top up when needed — full visibility into every token used.',
  },
  {
    icon: Gift,
    title: 'Growth & Referrals',
    description:
      'Earn credits by referring creators, track referral conversions, and grow your creator network — all from within the platform.',
  },
];

// ── How it works steps ───────────────────────────────────────────────────────

const STEPS = [
  {
    icon: Youtube,
    step: '01',
    title: 'Connect your channel',
    description: 'Link your YouTube channel with OAuth in one click. Permissions stay in your control.',
  },
  {
    icon: Upload,
    step: '02',
    title: 'Import a video',
    description: 'Pick any video from your library. AI CreatorForce pulls metadata and the transcript automatically.',
  },
  {
    icon: Cpu,
    step: '03',
    title: 'AI finds highlights',
    description: 'Our AI analyses pacing, engagement signals, and topic density to surface the strongest clip candidates.',
  },
  {
    icon: Scissors,
    step: '04',
    title: 'Edit & caption',
    description: 'Trim, reorder, add captions and b-roll in the timeline editor. Full creative control, zero friction.',
  },
  {
    icon: CheckCircle2,
    step: '05',
    title: 'Publish with confidence',
    description: 'Compliance check → human approval → scheduled or instant publish to YouTube. No guesswork.',
  },
];

// ── Nav links ────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Download', href: '#download' },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      {/* Smooth scroll — applied via a style tag; avoids touching layout.tsx */}
      <style>{`html { scroll-behavior: smooth; }`}</style>

      {/* ── Header / Nav ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo */}
            <Link
              href="/"
              className="flex items-center gap-2.5 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-lg"
              aria-label="AI CreatorForce — home"
            >
              <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm">
                <Zap className="w-5 h-5 text-brand-600" aria-hidden="true" />
              </div>
              <span className="font-bold text-white text-lg leading-none hidden sm:block">AI CreatorForce</span>
            </Link>

            {/* Desktop nav */}
            <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map(({ label, href }) => (
                <a
                  key={href}
                  href={href}
                  className="px-4 py-2 rounded-lg text-white/85 text-sm font-medium hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors min-h-[44px] flex items-center"
                >
                  {label}
                </a>
              ))}
            </nav>

            {/* Desktop CTAs */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <Link
                href="/login"
                className="px-4 py-2 rounded-xl text-white/90 text-sm font-semibold hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors min-h-[44px] flex items-center"
              >
                Log in
              </Link>
              <Link
                href="/login"
                className="px-5 py-2 rounded-xl bg-white text-brand-600 text-sm font-bold shadow hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors min-h-[44px] flex items-center"
              >
                Get started
              </Link>
            </div>

            {/* Mobile hamburger (client component) */}
            <MobileNav />
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section
          aria-label="Hero"
          className="relative overflow-hidden bg-gradient-to-br from-[#9d6ff0] via-[#8659e8] to-[#7c4fd8] text-white"
        >
          {/* Decorative blobs */}
          <div
            aria-hidden="true"
            className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5 blur-3xl pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="absolute bottom-0 -left-20 w-72 h-72 rounded-full bg-white/5 blur-2xl pointer-events-none"
          />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32 flex flex-col lg:flex-row items-center gap-14">
            {/* Copy */}
            <div className="flex-1 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm font-medium text-white/90 mb-6">
                <Zap className="w-4 h-4" aria-hidden="true" />
                AI-powered YouTube Content OS
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight">
                Turn long videos into{' '}
                <span className="text-yellow-300">publish-ready Shorts</span>
              </h1>
              <p className="mt-5 text-lg sm:text-xl text-white/80 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
                Edit with a full timeline, comply automatically, and publish to YouTube — AI-assisted end to end.
                From raw footage to growing channel, in minutes.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-white text-brand-600 font-bold text-base shadow-lg hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple-700 transition-colors min-h-[44px]"
                >
                  <Zap className="w-4 h-4" aria-hidden="true" />
                  Get started free
                </Link>
                <a
                  href="#download"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl border-2 border-white/40 text-white font-semibold text-base hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors min-h-[44px]"
                >
                  Download app
                </a>
              </div>
            </div>

            {/* Hero visual — styled div mockup, no external images */}
            <div
              className="flex-1 w-full max-w-lg lg:max-w-none"
              aria-hidden="true"
            >
              <div className="relative bg-white/10 border border-white/20 rounded-2xl p-4 shadow-2xl backdrop-blur-sm">
                {/* Fake browser chrome */}
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
                  <div className="flex-1 ml-2 h-5 bg-white/10 rounded-md" />
                </div>
                {/* Fake sidebar + content */}
                <div className="flex gap-3 h-52">
                  <div className="w-28 shrink-0 flex flex-col gap-2">
                    {['Shorts Studio', 'Video Editor', 'Automation', 'Approvals'].map((item, i) => (
                      <div
                        key={item}
                        className={`h-7 rounded-lg flex items-center px-2.5 text-[10px] font-medium ${
                          i === 0 ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'
                        }`}
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    <div className="h-28 rounded-xl bg-white/10 flex items-center justify-center">
                      <Clapperboard className="w-8 h-8 text-yellow-300/70" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 h-12 rounded-lg bg-white/10" />
                      <div className="flex-1 h-12 rounded-lg bg-white/10" />
                      <div className="flex-1 h-12 rounded-lg bg-white/10" />
                    </div>
                    <div className="h-5 w-3/4 rounded bg-white/10" />
                  </div>
                </div>
                {/* Fake timeline */}
                <div className="mt-3 flex gap-1 h-8">
                  {[40, 20, 60, 30, 50, 25, 45, 35, 55, 20].map((w, i) => (
                    <div
                      key={i}
                      className="h-full rounded bg-yellow-300/50 shrink-0"
                      style={{ width: `${w}px` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────────────────── */}
        <section
          id="features"
          aria-labelledby="features-heading"
          className="bg-white py-20 lg:py-28"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <p className="text-sm font-semibold text-brand-600 uppercase tracking-widest mb-2">Features</p>
              <h2 id="features-heading" className="text-3xl sm:text-4xl font-extrabold text-gray-900">
                Everything you need to grow on YouTube
              </h2>
              <p className="mt-4 text-lg text-gray-500 max-w-2xl mx-auto">
                From raw footage to growing audience — one platform, zero silos.
              </p>
            </div>

            <ul
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
              aria-label="Platform features"
            >
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <li
                  key={title}
                  className="group bg-gray-50 hover:bg-brand-50 border border-gray-100 hover:border-brand-200 rounded-2xl p-6 flex flex-col gap-4 transition-colors"
                >
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#9d6ff0] to-[#7c4fd8] flex items-center justify-center shadow-sm">
                    <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-base">{title}</h3>
                    <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────────── */}
        <section
          id="how-it-works"
          aria-labelledby="how-it-works-heading"
          className="bg-[#f8f5ff] py-20 lg:py-28"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <p className="text-sm font-semibold text-brand-600 uppercase tracking-widest mb-2">How it works</p>
              <h2 id="how-it-works-heading" className="text-3xl sm:text-4xl font-extrabold text-gray-900">
                From upload to published in minutes
              </h2>
            </div>

            <ol
              className="relative flex flex-col lg:flex-row gap-0 lg:gap-0"
              aria-label="Step-by-step process"
            >
              {STEPS.map(({ icon: Icon, step, title, description }, idx) => (
                <li key={step} className="flex-1 flex flex-col lg:items-center relative">
                  {/* Connector line (horizontal on lg, vertical on mobile) */}
                  {idx < STEPS.length - 1 && (
                    <>
                      {/* Mobile vertical line */}
                      <div
                        aria-hidden="true"
                        className="lg:hidden absolute left-[22px] top-[52px] w-0.5 h-[calc(100%-52px)] bg-brand-200"
                      />
                      {/* Desktop horizontal line */}
                      <div
                        aria-hidden="true"
                        className="hidden lg:block absolute top-[22px] left-[calc(50%+24px)] w-[calc(100%-48px)] h-0.5 bg-brand-200"
                      />
                    </>
                  )}

                  <div className="flex lg:flex-col items-start lg:items-center gap-4 lg:gap-3 px-0 lg:px-4 pb-10 lg:pb-0 relative">
                    <div className="shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-[#9d6ff0] to-[#7c4fd8] flex items-center justify-center shadow-md z-10">
                      <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                    </div>
                    <div className="lg:text-center">
                      <p className="text-[10px] font-bold text-brand-600 uppercase tracking-widest mb-0.5">
                        Step {step}
                      </p>
                      <h3 className="font-bold text-gray-900 text-sm sm:text-base">{title}</h3>
                      <p className="mt-1 text-xs sm:text-sm text-gray-500 leading-relaxed max-w-[220px] mx-auto">
                        {description}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Download ──────────────────────────────────────────────────────── */}
        <section
          id="download"
          aria-labelledby="download-heading"
          className="bg-white py-20 lg:py-28"
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <p className="text-sm font-semibold text-brand-600 uppercase tracking-widest mb-2">Download</p>
              <h2 id="download-heading" className="text-3xl sm:text-4xl font-extrabold text-gray-900">
                Take AI CreatorForce everywhere
              </h2>
              <p className="mt-4 text-gray-500 max-w-xl mx-auto">
                Native desktop and mobile apps are coming. In the meantime, the full platform runs right in your browser — no install needed.
              </p>
            </div>

            {/* Download buttons — client component handles click-to-toast */}
            <DownloadButtons />
          </div>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            {/* Brand */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow">
                <Zap className="w-5 h-5 text-brand-600" aria-hidden="true" />
              </div>
              <div>
                <p className="font-bold text-base leading-tight">AI CreatorForce</p>
                <p className="text-xs text-gray-400 mt-0.5">AI Content Platform</p>
              </div>
            </div>

            {/* Footer links */}
            <nav aria-label="Footer navigation">
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-400">
                <li>
                  <Link
                    href="/login"
                    className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded transition-colors"
                  >
                    Login
                  </Link>
                </li>
                <li>
                  <a
                    href="#features"
                    className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded transition-colors"
                  >
                    Features
                  </a>
                </li>
                <li>
                  <a
                    href="#download"
                    className="hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded transition-colors"
                  >
                    Download
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-xs text-gray-500">
            &copy; {new Date().getFullYear()} AI CreatorForce. All rights reserved.
          </div>
        </div>
      </footer>
    </>
  );
}
