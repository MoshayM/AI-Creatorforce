'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Settings, LogOut, Zap, Palette, Clapperboard, ListVideo, Wallet, Bell, Gauge, Gift, Building2, ChevronDown, Workflow, Film, Menu, X, Sparkles, Home, Bot, Upload, BookOpen, Code2, Activity, BarChart2, Compass, ArrowRightLeft, Award, Target, FlaskConical, Layers, ListOrdered, Search } from 'lucide-react';
import { CopilotPanel } from '@/components/copilot-panel';
import { api, clearTokens, getRefreshToken, type AppNotification } from '@/lib/api';

interface NavItem {
  href: string;
  icon: typeof FolderOpen;
  label: string;
  /** When true, this item acts as a collapsible group header (renders as <button>, not <Link>). */
  isGroup?: boolean;
  /** Render a subtle divider above this item. */
  dividerBefore?: boolean;
  /** Indented sub-links rendered directly beneath the item. */
  children?: NavItem[];
}

const NAV: NavItem[] = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/projects', icon: FolderOpen, label: 'Projects' },
  { href: '/shorts-studio', icon: Clapperboard, label: 'Shorts Studio' },
  { href: '/editor', icon: Film, label: 'Video Editor' },
  { href: '/copilot', icon: Bot, label: 'Copilot' },
  {
    href: '/publish-group',
    icon: Upload,
    label: 'Publish',
    isGroup: true,
    dividerBefore: true,
    children: [
      { href: '/publishing', icon: Upload, label: 'Publishing' },
      { href: '/autonomy', icon: Sparkles, label: 'Autonomy' },
      { href: '/ab-testing', icon: FlaskConical, label: 'A/B Testing' },
    ],
  },
  {
    href: '/content-group',
    icon: BookOpen,
    label: 'Content',
    isGroup: true,
    children: [
      { href: '/research', icon: BookOpen, label: 'Research' },
      { href: '/discover', icon: Compass, label: 'Discover' },
      { href: '/repurpose', icon: ArrowRightLeft, label: 'Repurpose' },
      { href: '/series-planner', icon: ListOrdered, label: 'Series Planner' },
      { href: '/score-script', icon: Award, label: 'Script Scorer' },
    ],
  },
  {
    href: '/insights-group',
    icon: BarChart2,
    label: 'Insights',
    isGroup: true,
    children: [
      { href: '/analytics', icon: BarChart2, label: 'Analytics' },
      { href: '/strategy', icon: Target, label: 'Strategy' },
      { href: '/growth', icon: Gift, label: 'Growth' },
      { href: '/monitor', icon: Activity, label: 'Monitor' },
    ],
  },
  {
    href: '/library-group',
    icon: ListVideo,
    label: 'Library',
    isGroup: true,
    children: [
      { href: '/library', icon: ListVideo, label: 'Media Control' },
      { href: '/assets', icon: Layers, label: 'Media Assets' },
    ],
  },
  {
    href: '/settings',
    icon: Settings,
    label: 'Settings',
    dividerBefore: true,
    children: [
      { href: '/brand-kit', icon: Palette, label: 'Brand Kit' },
      { href: '/automation', icon: Workflow, label: 'Automation' },
      { href: '/wallet', icon: Wallet, label: 'Billing & Wallet' },
      { href: '/orgs', icon: Building2, label: 'Organization' },
      { href: '/developer', icon: Code2, label: 'Developer' },
    ],
  },
];

/** Display name from the JWT payload — no network call, safe in mock mode. */
function nameFromToken(): string {
  try {
    const token = localStorage.getItem('cf_token');
    if (!token) return 'Creator';
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { name?: string; email?: string };
    return payload.name || payload.email?.split('@')[0] || 'Creator';
  } catch {
    return 'Creator';
  }
}

/**
 * Role from the JWT payload — used only to show/hide the Admin nav link.
 * The API enforces the real permission check; a forged token just sees a 403.
 */
function roleFromToken(): string {
  try {
    const token = localStorage.getItem('cf_token');
    if (!token) return 'MEMBER';
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { role?: string };
    return payload.role ?? 'MEMBER';
  } catch {
    return 'MEMBER';
  }
}

/** Format a Date as a relative string, e.g. "3m ago", "2h ago", "5d ago". */
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const BELL_POLL_MS = 60_000;

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState('Creator');
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me().then((r) => r.data),
    staleTime: 60_000,
    enabled: !!token,
  });
  /** Explicit expand/collapse choices per nav group; unset falls back to route-based auto-open. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  /** Sidebar collapsed state — collapses to icon-only rail. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Notifications bell state ───────────────────────────────────────────────
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    // Only fetch when the tab is visible
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const res = await api.notifications.list({ take: 20 });
      setNotifications(res.data.items);
      setUnreadCount(res.data.unreadCount);
    } catch {
      // Non-fatal — network errors are swallowed silently
    }
  }, []);

  useEffect(() => {
    const tok = localStorage.getItem('cf_token');
    if (!tok) {
      router.push('/login');
      return;
    }
    setToken(tok);
    setUserName(nameFromToken());
    setIsAdmin(['OWNER', 'SUPER_ADMIN'].includes(roleFromToken()));
    void fetchNotifications();
    pollRef.current = setInterval(() => { void fetchNotifications(); }, BELL_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [router, fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  async function handleMarkRead(id: string) {
    try {
      await api.notifications.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // Non-fatal
    }
  }

  async function handleMarkAllRead() {
    try {
      await api.notifications.markAllRead();
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
      setUnreadCount(0);
    } catch {
      // Non-fatal
    }
  }

  async function handleLogout() {
    const refreshToken = getRefreshToken() ?? undefined;
    // Fire-and-forget: inform the server; ignore network failures
    try {
      await api.auth.logout(refreshToken);
    } catch {
      // Non-fatal — proceed with local token clearance regardless
    }
    clearTokens();
    router.push('/login');
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[#F4F3FB] text-[#1E1B2E]">

      {/* ── TOPBAR ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3.5 px-[22px] py-[11px] bg-white border-b border-[#ECECF3] shrink-0 z-[5]">

        {/* Hamburger — collapses/expands sidebar */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(c => !c)}
          className="w-10 h-10 shrink-0 border border-[#ECECF3] rounded-[11px] bg-white text-[#5b5772] flex items-center justify-center hover:bg-[#F6F5FC] transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-[18px] h-[18px]" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-[38px] h-[38px] rounded-[11px] flex items-center justify-center"
            style={{background:'linear-gradient(135deg,#9C88DD,#7E62C9)',boxShadow:'0 6px 14px -6px rgba(124,58,237,.6)'}}
          >
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div className="leading-[1.15]">
            <div className="font-bold text-[15px] tracking-[-0.3px]">AI CreatorForce</div>
            <div className="text-[11px] font-medium" style={{color:'#8b88a0'}}>AI Content Platform</div>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex-1 max-w-[400px] ml-3 flex items-center gap-2.5 rounded-[12px] px-3.5 py-2.5" style={{background:'#F7F6FB',border:'1px solid #ECECF3'}}>
          <Search className="w-[18px] h-[18px] shrink-0" style={{color:'#9a97ab'}} />
          <input
            type="text"
            placeholder="Search projects, videos, channels…"
            className="border-none outline-none bg-transparent text-sm flex-1 text-[#1E1B2E] placeholder:text-[#9a97ab]"
            style={{fontFamily:'inherit'}}
          />
        </div>

        <div className="flex-1" />

        {/* Copilot button */}
        <button
          type="button"
          title="Ask Copilot"
          onClick={() => window.dispatchEvent(new CustomEvent('cf:open-copilot'))}
          className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center hover:opacity-90 transition-opacity shrink-0"
          style={{border:'1px solid #E4DEFB',background:'#F6F2FF',color:'#7C3AED'}}
        >
          <Bot className="w-[19px] h-[19px]" />
        </button>

        {/* Notification bell */}
        <div className="relative shrink-0" ref={bellRef}>
          <button
            type="button"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
            aria-haspopup="true"
            aria-expanded={bellOpen}
            onClick={() => { setBellOpen(o => !o); if (!bellOpen) void fetchNotifications(); }}
            className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center hover:bg-[#F6F5FC] transition-colors relative"
            style={{border:'1px solid #ECECF3',background:'#fff',color:'#5b5772'}}
          >
            <Bell className="w-[19px] h-[19px]" />
            {unreadCount > 0 && (
              <span
                className="absolute flex items-center justify-center text-white font-bold leading-none"
                style={{top:'-6px',right:'-6px',minWidth:'19px',height:'19px',padding:'0 5px',borderRadius:'20px',background:'#EF4444',fontSize:'11px',border:'2px solid #fff'}}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <div
              role="dialog"
              aria-label="Notifications"
              className="absolute right-0 z-50 bg-white overflow-hidden animate-drop-down"
              style={{top:'calc(100% + 10px)',width:'360px',border:'1px solid #ECECF3',borderRadius:'18px',boxShadow:'0 30px 70px -24px rgba(30,27,46,.4)'}}
            >
              <div className="flex items-center justify-between" style={{padding:'15px 18px',borderBottom:'1px solid #F1EFF7'}}>
                <span style={{fontSize:'15px',fontWeight:700,letterSpacing:'-.3px'}}>Notifications</span>
                {unreadCount > 0 && (
                  <button type="button" onClick={() => void handleMarkAllRead()} className="border-none bg-transparent cursor-pointer" style={{fontSize:'12.5px',fontWeight:700,color:'#7C3AED',fontFamily:'inherit'}}>
                    Mark all read
                  </button>
                )}
              </div>
              <ul style={{maxHeight:'340px',overflowY:'auto'}}>
                {notifications.length === 0 ? (
                  <li style={{padding:'36px 20px',textAlign:'center'}}>
                    <div style={{width:'46px',height:'46px',margin:'0 auto 12px',borderRadius:'14px',background:'#F3F2F9',color:'#c3c0d2',display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <Bell className="w-[22px] h-[22px]" />
                    </div>
                    <div style={{fontSize:'13.5px',fontWeight:700,color:'#6b6880'}}>You&apos;re all caught up</div>
                    <div style={{fontSize:'12.5px',color:'#a8a5b8',fontWeight:500,marginTop:'2px'}}>No new notifications</div>
                  </li>
                ) : (
                  notifications.map((n) => (
                    <li key={n.id} style={{display:'flex',alignItems:'flex-start',gap:'12px',padding:'13px 16px',borderBottom:'1px solid #F6F5FB'}}>
                      <div style={{flex:'1 1 auto',minWidth:0,cursor:'pointer'}} onClick={() => { if (!n.readAt) void handleMarkRead(n.id); }}>
                        <div style={{display:'flex',alignItems:'baseline',gap:'8px'}}>
                          <div style={{fontSize:'13.5px',fontWeight:700,flex:'1 1 auto'}}>{n.title}</div>
                          <div style={{fontSize:'11px',color:'#a8a5b8',fontWeight:600,flexShrink:0}}>{relativeTime(n.createdAt)}</div>
                        </div>
                        {n.body && <div style={{fontSize:'12.5px',color:'#8b88a0',fontWeight:500,lineHeight:1.45,marginTop:'2px'}}>{n.body}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => { if (!n.readAt) void handleMarkRead(n.id); setBellOpen(false); }}
                        className="flex items-center justify-center border-none cursor-pointer hover:bg-[#FDECEC] hover:text-[#EF4444] transition-all"
                        style={{flexShrink:0,width:'26px',height:'26px',borderRadius:'8px',background:'transparent',color:'#c3c0d2'}}
                        title="Dismiss"
                      >
                        <X className="w-[15px] h-[15px]" />
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <Link
                href="/notifications"
                onClick={() => setBellOpen(false)}
                className="block w-full text-center text-xs font-semibold hover:bg-[#F6F5FC]"
                style={{padding:'10px',color:'#7C3AED',borderTop:'1px solid #ECECF3'}}
              >
                View all notifications →
              </Link>
            </div>
          )}
        </div>

        {/* User chip */}
        <div className="flex items-center gap-2.5 hover:bg-[#F6F5FC] transition-colors cursor-pointer shrink-0" style={{background:'#fff',border:'1px solid #ECECF3',borderRadius:'12px',padding:'5px 14px 5px 5px'}}>
          {meData?.avatarUrl ? (
            <img src={meData.avatarUrl} alt={meData.name ?? 'Avatar'} style={{width:'32px',height:'32px',borderRadius:'9px',objectFit:'cover'}} />
          ) : (
            <div className="flex items-center justify-center text-white font-bold text-sm uppercase" style={{width:'32px',height:'32px',borderRadius:'9px',background:'linear-gradient(135deg,#9C88DD,#7E62C9)'}}>
              {(meData?.name ?? userName).charAt(0)}
            </div>
          )}
          <div style={{lineHeight:1.2}}>
            <div style={{fontWeight:700,fontSize:'13.5px'}}>{meData?.name ?? userName}</div>
            <div style={{fontSize:'11.5px',color:'#8b88a0',fontWeight:500}}>Creator</div>
          </div>
        </div>
      </header>

      {/* ── BODY: sidebar + main ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
        <aside
          className={`flex flex-col p-[10px] overflow-hidden shrink-0 transition-[width] duration-[320ms] ease-[cubic-bezier(.4,0,.2,1)]`}
          style={{background:'linear-gradient(185deg,#7C3AED 0%,#5B21B6 100%)',width: sidebarCollapsed ? '52px' : '224px'}}
        >
          <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto overflow-x-hidden" style={{scrollbarWidth:'none'}}>
            {[...NAV, ...(isAdmin ? [{ href:'/admin', icon: Gauge, label:'Admin' } as NavItem] : [])].map(({ href, icon: Icon, label, children, isGroup, dividerBefore }) => {
              const groupActive = isGroup
                ? (children?.some(c => !c.href.includes('#') && pathname.startsWith(c.href)) ?? false)
                : (pathname === href || pathname.startsWith(href + '/') || (children?.some(c => !c.href.includes('#') && pathname.startsWith(c.href)) ?? false));
              const open = openGroups[href] ?? groupActive;
              const isActiveLink = !isGroup && (pathname === href || pathname.startsWith(href + '/'));

              return (
                <div key={href}>
                  {dividerBefore && <div style={{margin:'6px 10px',borderTop:'1px solid rgba(255,255,255,.15)'}} />}

                  {isGroup ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenGroups(g => ({ ...g, [href]: !open }))}
                      className="w-full flex items-center transition-colors"
                      style={{
                        gap:'11px',padding:'9px 10px',borderRadius:'10px',cursor:'pointer',
                        fontSize:'12.5px',fontWeight:600,border:'none',
                        background: groupActive ? 'rgba(255,255,255,.18)' : 'transparent',
                        color: groupActive ? '#fff' : 'rgba(255,255,255,.82)',
                      }}
                      onMouseEnter={e => { if (!groupActive) (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,.12)'; }}
                      onMouseLeave={e => { if (!groupActive) (e.currentTarget as HTMLElement).style.background='transparent'; }}
                    >
                      <Icon style={{width:'18px',height:'18px',flexShrink:0}} />
                      <span style={{whiteSpace:'nowrap',overflow:'hidden',flex:'1 1 auto',textAlign:'left',opacity: sidebarCollapsed ? 0 : 1,transition:'opacity .2s'}}>
                        {label}
                      </span>
                      {!sidebarCollapsed && (
                        <ChevronDown style={{width:'14px',height:'14px',flexShrink:0,transform: open ? 'none' : 'rotate(-90deg)',transition:'transform .2s'}} />
                      )}
                    </button>
                  ) : (
                    <div style={{position:'relative'}}>
                      <Link
                        href={href}
                        className="flex items-center transition-colors"
                        style={{
                          gap:'11px',padding:'9px 10px',borderRadius:'10px',
                          fontSize:'12.5px',fontWeight:600,textDecoration:'none',
                          background: isActiveLink ? 'rgba(255,255,255,.18)' : 'transparent',
                          color: isActiveLink ? '#fff' : 'rgba(255,255,255,.82)',
                        }}
                        onMouseEnter={e => { if (!isActiveLink) (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,.12)'; }}
                        onMouseLeave={e => { if (!isActiveLink) (e.currentTarget as HTMLElement).style.background='transparent'; (e.currentTarget as HTMLElement).style.color='rgba(255,255,255,.82)'; }}
                      >
                        <Icon style={{width:'18px',height:'18px',flexShrink:0}} />
                        <span style={{whiteSpace:'nowrap',overflow:'hidden',flex:'1 1 auto',opacity: sidebarCollapsed ? 0 : 1,transition:'opacity .2s'}}>
                          {label}
                        </span>
                        {children && children.length > 0 && !sidebarCollapsed && (
                          <ChevronDown style={{width:'14px',height:'14px',flexShrink:0,transform: open ? 'none' : 'rotate(-90deg)',transition:'transform .2s'}} />
                        )}
                      </Link>
                      {!isGroup && children && children.length > 0 && (
                        <button
                          type="button"
                          aria-label={`${open ? 'Collapse' : 'Expand'} ${label} menu`}
                          aria-expanded={open}
                          onClick={e => { e.preventDefault(); setOpenGroups(g => ({ ...g, [href]: !open })); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer"
                          style={{padding:'4px',borderRadius:'6px',color:'rgba(255,255,255,.7)'}}
                        />
                      )}
                    </div>
                  )}

                  {open && !sidebarCollapsed && children?.map(({ href: subHref, icon: SubIcon, label: subLabel }) => (
                    <Link
                      key={subHref}
                      href={subHref}
                      className="flex items-center transition-colors"
                      style={{
                        gap:'9px',padding:'8px 10px 8px 36px',borderRadius:'10px',marginTop:'1px',
                        fontSize:'12px',fontWeight:600,textDecoration:'none',
                        background: (!subHref.includes('#') && pathname.startsWith(subHref)) ? 'rgba(255,255,255,.18)' : 'transparent',
                        color: (!subHref.includes('#') && pathname.startsWith(subHref)) ? '#fff' : 'rgba(255,255,255,.70)',
                      }}
                      onMouseEnter={e => { if (!(!subHref.includes('#') && pathname.startsWith(subHref))) (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,.12)'; }}
                      onMouseLeave={e => { if (!(!subHref.includes('#') && pathname.startsWith(subHref))) (e.currentTarget as HTMLElement).style.background='transparent'; }}
                    >
                      <SubIcon style={{width:'15px',height:'15px',flexShrink:0}} />
                      <span style={{whiteSpace:'nowrap',overflow:'hidden'}}>{subLabel}</span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>

          {/* Sign out */}
          <button
            onClick={() => void handleLogout()}
            className="flex items-center transition-colors border-none cursor-pointer"
            style={{
              marginTop:'6px',gap:'11px',padding:'9px 10px',borderRadius:'10px',
              fontSize:'12.5px',fontWeight:600,
              color:'rgba(255,255,255,.82)',background:'transparent',fontFamily:'inherit',
              width:'100%',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,.12)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; }}
          >
            <LogOut style={{width:'17px',height:'17px',flexShrink:0}} />
            <span style={{whiteSpace:'nowrap',overflow:'hidden',opacity: sidebarCollapsed ? 0 : 1,transition:'opacity .2s'}}>Sign Out</span>
          </button>
        </aside>

        {/* ── MAIN ─────────────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>

      <CopilotPanel />
    </div>
  );
}
