import Link from 'next/link';
import {
  Zap, Clapperboard, Film, Scissors, FileText, Mic2, Music2,
  BookOpen, BarChart2, LayoutTemplate, TrendingUp, Upload, Layers,
  Bot, ArrowRight, CheckCircle2, ChevronRight, Sparkles, ShieldCheck,
} from 'lucide-react';
import { MobileNav } from './_components/MobileNav';

// ── Capabilities ──────────────────────────────────────────────────────────────

const CAPABILITIES = [
  { icon: Bot,           color: '#7C3AED', bg: '#F3EEFF', title: 'Natural Language AI Assistant',  desc: 'Describe what you want. The AI handles the rest — no forms, no menus.' },
  { icon: FileText,      color: '#2563EB', bg: '#EFF6FF', title: 'AI Script Writing',              desc: 'Research-backed scripts crafted for your niche, tone, and target audience.' },
  { icon: Clapperboard,  color: '#DC2626', bg: '#FFF1F1', title: 'AI Video Creation',              desc: 'Full production pipeline: research → script → voice → music → render.' },
  { icon: Mic2,          color: '#059669', bg: '#ECFDF5', title: 'Voice Generation',               desc: 'Studio-quality AI voice-over in 30+ languages with natural rhythm and pacing.' },
  { icon: Music2,        color: '#D97706', bg: '#FFFBEB', title: 'Music Generation',               desc: 'Original background music tuned to mood, genre, and video duration.' },
  { icon: Scissors,      color: '#7C3AED', bg: '#F3EEFF', title: 'Shorts Generation',              desc: 'AI finds the best highlights from long-form video and auto-creates Shorts.' },
  { icon: Film,          color: '#0891B2', bg: '#ECFEFF', title: 'Professional Editing',           desc: 'Multi-track timeline with effects, transitions, captions, and export.' },
  { icon: LayoutTemplate,color: '#BE185D', bg: '#FDF2F8', title: 'Thumbnail Generation',          desc: 'Eye-catching thumbnails designed to maximise click-through rates.' },
  { icon: BookOpen,      color: '#1D4ED8', bg: '#EFF6FF', title: 'AI Research',                   desc: 'Deep topic research with fact-checking and source verification built in.' },
  { icon: TrendingUp,    color: '#065F46', bg: '#ECFDF5', title: 'AI SEO Optimisation',           desc: 'Titles, descriptions, and tags engineered to rank and surface to the right audience.' },
  { icon: BarChart2,     color: '#7C3AED', bg: '#F3EEFF', title: 'Channel Analysis',              desc: 'Understand what is working, what is not, and exactly what to do next.' },
  { icon: Upload,        color: '#DC2626', bg: '#FFF1F1', title: 'AI Publishing',                 desc: 'Compliance-gated, scheduled publishing to YouTube and beyond.' },
  { icon: Layers,        color: '#0891B2', bg: '#ECFEFF', title: 'Multi-Channel Management',      desc: 'Manage multiple channels and brands from a single AI-powered workspace.' },
  { icon: ShieldCheck,   color: '#059669', bg: '#ECFDF5', title: 'Compliance Engine',             desc: 'Every piece of content passes copyright, monetisation, and policy checks.' },
];

// ── Workflow steps ─────────────────────────────────────────────────────────────

const WORKFLOW = [
  { icon: Sparkles,      label: 'Idea',                sub: 'Tell the AI what you want to create' },
  { icon: Bot,           label: 'AI Conversation',     sub: 'Copilot gathers requirements naturally' },
  { icon: BookOpen,      label: 'Research & Planning', sub: 'AI researches, outlines, and plans' },
  { icon: FileText,      label: 'Script',              sub: 'Fact-checked, SEO-optimised script' },
  { icon: Mic2,          label: 'Voice',               sub: 'Natural AI voice-over generated' },
  { icon: Music2,        label: 'Music',               sub: 'Original background track created' },
  { icon: Clapperboard,  label: 'Video',               sub: 'Scenes rendered automatically' },
  { icon: Film,          label: 'Professional Editing',sub: 'Transitions, captions, colour grade' },
  { icon: ShieldCheck,   label: 'Compliance Review',   sub: 'Copyright and policy checks pass' },
  { icon: Upload,        label: 'Publishing',          sub: 'Scheduled, approved, published' },
];

// ── Nav links ─────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: 'Features',    href: '#features' },
  { label: 'How it works',href: '#workflow' },
  { label: 'Pricing',     href: '#pricing' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      <style>{`
        html { scroll-behavior: smooth; }
        .glow-ring { box-shadow: 0 0 0 1px rgba(124,58,237,.15), 0 0 24px rgba(124,58,237,.12); }
        @keyframes float-slow { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-10px); } }
        .float-slow { animation: float-slow 6s ease-in-out infinite; }
        @keyframes pulse-soft { 0%,100% { opacity:.6; } 50% { opacity:1; } }
        .pulse-soft { animation: pulse-soft 3s ease-in-out infinite; }
      `}</style>

      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/10 backdrop-blur-xl" style={{background:'rgba(14,9,36,.85)'}}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <Link href="/" className="flex items-center gap-2.5 shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="AI CreatorForce">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}>
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-white text-lg leading-none hidden sm:block tracking-tight">AI CreatorForce</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1" aria-label="Primary navigation">
              {NAV_LINKS.map(({ label, href }) => (
                <a key={href} href={href} className="px-4 py-2 rounded-lg text-white/70 text-sm font-medium hover:text-white hover:bg-white/8 transition-colors min-h-[44px] flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  {label}
                </a>
              ))}
            </nav>

            <div className="hidden md:flex items-center gap-2 shrink-0">
              <Link href="/login" className="px-4 py-2 rounded-xl text-white/80 text-sm font-semibold hover:text-white hover:bg-white/8 transition-colors min-h-[44px] flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                Log in
              </Link>
              <Link href="/login" className="px-5 py-2 rounded-xl text-sm font-bold shadow-lg min-h-[44px] flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-all hover:opacity-90" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)',color:'#fff'}}>
                Get started free
              </Link>
            </div>

            <MobileNav />
          </div>
        </div>
      </header>

      <main>
        {/* ── HERO ─────────────────────────────────────────────────────────────── */}
        <section aria-label="Hero" style={{background:'linear-gradient(160deg,#0e0924 0%,#1a0f4a 40%,#2d1b6e 100%)'}}>
          {/* Background decorations */}
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-20" style={{background:'radial-gradient(ellipse,#7C3AED 0%,transparent 70%)',filter:'blur(40px)'}} />
            <div className="absolute top-1/3 left-[10%] w-72 h-72 rounded-full opacity-10" style={{background:'#a78bfa',filter:'blur(60px)'}} />
            <div className="absolute top-1/4 right-[8%] w-52 h-52 rounded-full opacity-10" style={{background:'#818cf8',filter:'blur(50px)'}} />
          </div>

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-36 text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 mb-8 text-sm font-medium text-white/80" style={{background:'rgba(124,58,237,.15)'}}>
              <Zap className="w-3.5 h-3.5 text-purple-400" />
              The AI Content Operating System
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white leading-[1.05] tracking-tight max-w-5xl mx-auto">
              Create. Edit. Publish.
              <br />
              <span style={{background:'linear-gradient(90deg,#c4b5fd,#818cf8,#a78bfa)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
                All with AI.
              </span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-white/60 max-w-2xl mx-auto leading-relaxed">
              From a single conversation to a published video — CreatorForce handles research, scripting, voice, music, editing, and publishing.{' '}
              <span className="text-white/80">No forms. No menus. Just results.</span>
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-bold text-white text-base shadow-2xl transition-all hover:opacity-90 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)',boxShadow:'0 20px 50px -12px rgba(124,58,237,.6)'}}>
                <Zap className="w-4 h-4" />
                Start creating free
              </Link>
              <a href="#workflow" className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-semibold text-white text-base transition-all hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" style={{border:'1.5px solid rgba(255,255,255,.2)'}}>
                See how it works
                <ChevronRight className="w-4 h-4" />
              </a>
            </div>

            {/* Hero visual — AI workspace mockup */}
            <div className="mt-20 max-w-4xl mx-auto float-slow">
              <div className="glow-ring rounded-3xl overflow-hidden" style={{background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.1)'}}>
                {/* Browser chrome */}
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                  <div className="flex-1 mx-3 h-5 rounded-md" style={{background:'rgba(255,255,255,.06)'}} />
                </div>

                <div className="flex h-80 lg:h-96">
                  {/* Sidebar */}
                  <div className="w-44 shrink-0 border-r border-white/8 p-3 flex flex-col gap-1 hidden sm:flex">
                    {['Home','Projects','Copilot','Shorts Studio','Video Editor','Publish','Analytics'].map((item, i) => (
                      <div key={item} className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{background: i===2?'rgba(124,58,237,.35)':'transparent',color: i===2?'#c4b5fd':'rgba(255,255,255,.5)'}}>
                        <div className="w-3 h-3 rounded-sm shrink-0" style={{background:i===2?'#a78bfa':'rgba(255,255,255,.2)'}} />
                        {item}
                      </div>
                    ))}
                  </div>

                  {/* Main content */}
                  <div className="flex-1 p-5 flex flex-col gap-4">
                    {/* Copilot chat */}
                    <div className="flex-1 rounded-2xl p-4 flex flex-col gap-3" style={{background:'rgba(255,255,255,.03)',border:'1px solid rgba(255,255,255,.06)'}}>
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}>
                          <Bot className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs leading-relaxed" style={{background:'rgba(167,139,250,.15)',color:'#e0d7ff'}}>
                            Hello! I&apos;m your AI Creative Director. What would you like to create today?
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 flex-row-reverse">
                        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center font-bold text-xs" style={{background:'linear-gradient(135deg,#f472b6,#ec4899)',color:'#fff'}}>
                          U
                        </div>
                        <div className="rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs" style={{background:'rgba(255,255,255,.08)',color:'rgba(255,255,255,.85)'}}>
                          Create a 10-minute YouTube video on AI trends in 2026.
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}>
                          <Bot className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs leading-relaxed" style={{background:'rgba(167,139,250,.15)',color:'#e0d7ff'}}>
                            Great choice! I&apos;ll start with research. Who is your target audience?
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {['Tech enthusiasts','Business owners','General audience'].map(t => (
                              <span key={t} className="px-2.5 py-1 rounded-full text-[10px] font-medium cursor-pointer" style={{background:'rgba(167,139,250,.2)',color:'#c4b5fd',border:'1px solid rgba(167,139,250,.3)'}}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="rounded-xl p-3 flex items-center gap-3" style={{background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.06)'}}>
                      <Sparkles className="w-4 h-4 shrink-0 pulse-soft" style={{color:'#a78bfa'}} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold" style={{color:'rgba(255,255,255,.8)'}}>AI Research in progress…</span>
                          <span className="text-[10px]" style={{color:'rgba(255,255,255,.5)'}}>42%</span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{background:'rgba(255,255,255,.08)'}}>
                          <div className="h-full rounded-full" style={{width:'42%',background:'linear-gradient(90deg,#a78bfa,#7C3AED)'}} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Trust badges */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm font-medium">
              {[
                { icon: CheckCircle2, label: 'No credit card required' },
                { icon: ShieldCheck, label: 'Compliance built in' },
                { icon: Zap, label: 'Publish in minutes' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2" style={{color:'rgba(255,255,255,.5)'}}>
                  <Icon className="w-4 h-4" style={{color:'#a78bfa'}} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CAPABILITIES ─────────────────────────────────────────────────────── */}
        <section id="features" aria-labelledby="features-heading" className="bg-white py-24 lg:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <p className="text-sm font-bold uppercase tracking-widest mb-3" style={{color:'#7C3AED'}}>Full capability suite</p>
              <h2 id="features-heading" className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight">
                Everything a creator needs,
                <br className="hidden sm:block" />
                <span style={{color:'#7C3AED'}}> powered by AI</span>
              </h2>
              <p className="mt-5 text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
                One platform replaces your entire content production stack. Script to publish, in one conversation.
              </p>
            </div>

            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" aria-label="Platform capabilities">
              {CAPABILITIES.map(({ icon: Icon, color, bg, title, desc }) => (
                <li key={title} className="group bg-white border border-gray-100 hover:border-gray-200 rounded-2xl p-5 flex flex-col gap-3 transition-all hover:shadow-lg hover:-translate-y-0.5">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110" style={{background:bg}}>
                    <Icon className="w-5 h-5" style={{color}} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm leading-snug">{title}</h3>
                    <p className="mt-1 text-xs text-gray-500 leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── WORKFLOW ─────────────────────────────────────────────────────────── */}
        <section id="workflow" aria-labelledby="workflow-heading" style={{background:'#f8f5ff'}} className="py-24 lg:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <p className="text-sm font-bold uppercase tracking-widest mb-3" style={{color:'#7C3AED'}}>End-to-end AI pipeline</p>
              <h2 id="workflow-heading" className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight">
                Idea to published,
                <span style={{color:'#7C3AED'}}> on autopilot</span>
              </h2>
              <p className="mt-5 text-lg text-gray-500 max-w-2xl mx-auto">
                Tell the AI what you want. It handles every step — you stay in control.
              </p>
            </div>

            {/* Step grid — 5 columns × 2 rows */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {WORKFLOW.map(({ icon: Icon, label, sub }, idx) => (
                <div key={label} className="relative flex flex-col items-center text-center group">
                  {/* Connector (right side) */}
                  {idx % 5 !== 4 && (
                    <div aria-hidden="true" className="hidden lg:block absolute top-8 left-[calc(50%+28px)] right-0 h-px" style={{background:'linear-gradient(90deg,#c4b5fd,transparent)'}} />
                  )}

                  <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center shadow-md mb-4 transition-transform group-hover:scale-110 group-hover:shadow-lg" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}>
                    <Icon className="w-7 h-7 text-white" />
                    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{background:'#5B21B6'}}>
                      {idx + 1}
                    </div>
                  </div>

                  <h3 className="font-bold text-gray-900 text-sm leading-tight mb-1">{label}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed max-w-[140px]">{sub}</p>
                </div>
              ))}
            </div>

            {/* CTA below workflow */}
            <div className="text-center mt-14">
              <Link href="/login" className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl font-bold text-white text-base transition-all hover:opacity-90 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-500 shadow-2xl" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)',boxShadow:'0 16px 40px -10px rgba(124,58,237,.5)'}}>
                <Zap className="w-4 h-4" />
                Start your first AI project
                <ArrowRight className="w-4 h-4" />
              </Link>
              <p className="mt-3 text-sm text-gray-500">Free to start · No credit card required</p>
            </div>
          </div>
        </section>

        {/* ── AI CONVERSATION DEMO ─────────────────────────────────────────────── */}
        <section aria-label="AI Copilot demo" className="bg-white py-24 lg:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest mb-3" style={{color:'#7C3AED'}}>Natural language first</p>
                <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight">
                  No forms.<br />No menus.<br />
                  <span style={{color:'#7C3AED'}}>Just conversation.</span>
                </h2>
                <p className="mt-6 text-lg text-gray-500 leading-relaxed">
                  CreatorForce&apos;s AI Copilot works like an experienced producer. Tell it what you need — it asks the right questions, fills in the gaps, and gets it done.
                </p>
                <ul className="mt-8 space-y-4">
                  {[
                    { t: 'Voice & text input', d: 'Speak or type — the Copilot understands both.' },
                    { t: 'Multi-language support', d: 'Responds in your language: English, Hindi, Tamil, and 30+ more.' },
                    { t: 'Session memory', d: 'Remembers what you said so you never repeat yourself.' },
                    { t: 'Action confirmation', d: 'Always asks before launching expensive AI jobs.' },
                  ].map(({ t, d }) => (
                    <li key={t} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{background:'#EDE9FE'}}>
                        <CheckCircle2 className="w-3.5 h-3.5" style={{color:'#7C3AED'}} />
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900 text-sm">{t}</span>
                        <span className="text-gray-500 text-sm"> — {d}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-10">
                  <Link href="/login" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}>
                    Try the AI Copilot <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>

              {/* Copilot visual */}
              <div className="relative">
                <div className="absolute inset-0 rounded-3xl" style={{background:'radial-gradient(ellipse at 50% 50%,rgba(124,58,237,.08) 0%,transparent 70%)'}} />
                <div className="relative rounded-3xl overflow-hidden shadow-2xl" style={{background:'#1a1033',border:'1px solid rgba(255,255,255,.08)'}}>
                  <div className="p-5 space-y-4">
                    {/* Orb */}
                    <div className="flex justify-center py-4">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)',boxShadow:'0 0 0 12px rgba(124,58,237,.12),0 0 0 24px rgba(124,58,237,.06)'}}>
                          <Bot className="w-9 h-9 text-white" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{background:'#10B981',border:'2px solid #1a1033'}}>
                          <div className="w-2 h-2 rounded-full bg-white pulse-soft" />
                        </div>
                      </div>
                    </div>

                    <p className="text-center text-xs font-medium" style={{color:'rgba(255,255,255,.5)'}}>Copilot ready · Listening…</p>

                    {/* Chat messages */}
                    <div className="space-y-3 pt-2">
                      {[
                        { role:'ai',  text:"What kind of content do you want to create today?" },
                        { role:'user',text:"Take last week's sermon and create 10 Shorts for YouTube." },
                        { role:'ai',  text:"Got it! Preferred duration for each Short? 30s / 45s / 60s?" },
                        { role:'user',text:"45 seconds each, with subtitles." },
                        { role:'ai',  text:"Perfect. Should I use the original voice or generate an AI voice-over?" },
                      ].map(({ role, text }, i) => (
                        <div key={i} className={`flex ${role==='user'?'flex-row-reverse':''} items-end gap-2`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${role==='ai'?'':'opacity-90'}`} style={{background:role==='ai'?'linear-gradient(135deg,#a78bfa,#7C3AED)':'linear-gradient(135deg,#f472b6,#ec4899)',color:'#fff'}}>
                            {role==='ai'?'AI':'U'}
                          </div>
                          <div className="max-w-[76%] px-3 py-2 rounded-xl text-[11px] leading-relaxed" style={{background:role==='ai'?'rgba(167,139,250,.12)':'rgba(255,255,255,.08)',color:role==='ai'?'#e0d7ff':'rgba(255,255,255,.85)',borderRadius:role==='ai'?'18px 18px 18px 4px':'18px 18px 4px 18px'}}>
                            {text}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Input */}
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mt-2" style={{background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)'}}>
                      <Mic2 className="w-4 h-4 shrink-0" style={{color:'#a78bfa'}} />
                      <span className="text-xs flex-1" style={{color:'rgba(255,255,255,.35)'}}>Speak or type a message…</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ─────────────────────────────────────────────────────────── */}
        <section aria-label="Call to action" style={{background:'linear-gradient(160deg,#0e0924 0%,#1a0f4a 50%,#2d1b6e 100%)'}}>
          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32 text-center">
            <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-20" style={{background:'radial-gradient(ellipse,#7C3AED 0%,transparent 70%)',filter:'blur(50px)'}} />
            </div>
            <div className="relative">
              <p className="text-sm font-bold uppercase tracking-widest mb-4" style={{color:'#a78bfa'}}>Start today</p>
              <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
                Your AI studio is<br />ready when you are.
              </h2>
              <p className="mt-6 text-lg text-white/60 max-w-xl mx-auto">
                Join creators already building professional content with AI. Free to start — no credit card required.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/login" className="inline-flex items-center justify-center gap-2 px-10 py-4 rounded-2xl font-bold text-white text-base shadow-2xl transition-all hover:opacity-90 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)',boxShadow:'0 20px 50px -12px rgba(124,58,237,.6)'}}>
                  <Zap className="w-5 h-5" />
                  Get started free
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm">
                {['No credit card required','Cancel any time','14-day free trial'].map(t => (
                  <span key={t} className="flex items-center gap-1.5" style={{color:'rgba(255,255,255,.45)'}}>
                    <CheckCircle2 className="w-4 h-4" style={{color:'#a78bfa'}} />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer style={{background:'#07041a',borderTop:'1px solid rgba(255,255,255,.06)'}} className="text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}>
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-base leading-tight">AI CreatorForce</p>
                <p className="text-xs mt-0.5" style={{color:'rgba(255,255,255,.35)'}}>AI Content Operating System</p>
              </div>
            </div>
            <nav aria-label="Footer navigation">
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{color:'rgba(255,255,255,.4)'}}>
                {[{label:'Features',href:'#features'},{label:'Workflow',href:'#workflow'},{label:'Log in',href:'/login'}].map(({label,href}) => (
                  <li key={label}>
                    <a href={href} className="hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="mt-8 pt-8 text-center text-xs" style={{borderTop:'1px solid rgba(255,255,255,.06)',color:'rgba(255,255,255,.25)'}}>
            &copy; {new Date().getFullYear()} AI CreatorForce. All rights reserved.
          </div>
        </div>
      </footer>
    </>
  );
}
