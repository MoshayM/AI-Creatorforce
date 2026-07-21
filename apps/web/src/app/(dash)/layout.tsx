'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Settings, LogOut, Palette, Clapperboard, ListVideo, Wallet, Bell, ShieldCheck, Building2, ChevronDown, Film, Menu, X, Home, Bot, Upload, BookOpen, BarChart2, Search } from 'lucide-react';
import { CopilotPanel } from '@/components/copilot-panel';
import { LogoMark } from '@/components/logo-mark';
import { api, clearTokens, getRefreshToken, type AppNotification } from '@/lib/api';

interface NavItem {
  href: string;
  icon: typeof FolderOpen;
  label: string;
  badge?: string;
  action?: () => void;
}

interface NavSection {
  category?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: '/home',     icon: Home,     label: 'Home' },
      { href: '/content',  icon: BookOpen, label: 'Content' },
      { href: '/projects', icon: FolderOpen, label: 'Projects' },
    ],
  },
  {
    items: [
      { href: '/shorts-studio', icon: Clapperboard, label: 'Shorts Studio' },
      { href: '/editor', icon: Film, label: 'Video Editor' },
    ],
  },
  {
    items: [
      { href: '/publish',  icon: Upload,    label: 'Publish' },
      { href: '/insights', icon: BarChart2, label: 'Insights' },
    ],
  },
  {
    items: [
      { href: '/library', icon: ListVideo, label: 'Media Control' },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { href: '/settings', icon: Settings, label: 'Settings' },
  { href: '/brand-kit', icon: Palette, label: 'Brand Kit' },
  { href: '/wallet', icon: Wallet, label: 'Billing' },
  { href: '/orgs', icon: Building2, label: 'Organization' },
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
  /** Sidebar collapsed state — collapses to icon-only rail. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Which collapsible sections are open (Studio is always open, not tracked here). */
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set<string>([])
  );
  function toggleSection(cat: string) {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  // ── User menu state ────────────────────────────────────────────────────────
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // Close dropdowns on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
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
          <LogoMark className="w-[38px] h-[38px] shrink-0" style={{borderRadius:'11px',boxShadow:'0 6px 14px -6px rgba(124,58,237,.5)'}} />
          <div className="leading-[1.15]">
            <div className="font-bold text-[15px] tracking-[-0.3px]">Blueforce</div>
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

        {/* Admin button — only visible to OWNER / SUPER_ADMIN */}
        {isAdmin && (
          <Link
            href="/admin"
            title="Admin panel"
            className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center transition-colors shrink-0"
            style={{border:'1px solid #E4DEFB',background:'#F6F2FF',color:'#7C3AED'}}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#EDE9FD'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='#F6F2FF'; }}
          >
            <ShieldCheck className="w-[19px] h-[19px]" />
          </Link>
        )}

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

        {/* User menu */}
        <div className="relative shrink-0" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen(o => !o)}
            className="flex items-center gap-2.5 hover:bg-[#F6F5FC] transition-colors cursor-pointer"
            style={{background:'#fff',border:'1px solid #ECECF3',borderRadius:'12px',padding:'5px 14px 5px 5px'}}
          >
            {meData?.avatarUrl ? (
              <img src={meData.avatarUrl} alt={meData.name ?? 'Avatar'} style={{width:'32px',height:'32px',borderRadius:'9px',objectFit:'cover'}} />
            ) : (
              <div className="flex items-center justify-center text-white font-bold text-sm uppercase" style={{width:'32px',height:'32px',borderRadius:'9px',background:'linear-gradient(135deg,#9C88DD,#7E62C9)'}}>
                {(meData?.name ?? userName).charAt(0)}
              </div>
            )}
            <div style={{lineHeight:1.2,textAlign:'left'}}>
              <div style={{fontWeight:700,fontSize:'13.5px'}}>{meData?.name ?? userName}</div>
              <div style={{fontSize:'11.5px',color:'#8b88a0',fontWeight:500}}>Creator</div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0" style={{color:'#9a97ab',transform: userMenuOpen ? 'rotate(180deg)' : 'none',transition:'transform 200ms ease'}} />
          </button>

          {userMenuOpen && (
            <div
              className="absolute right-0 z-50 bg-white overflow-hidden"
              style={{top:'calc(100% + 8px)',width:'220px',border:'1px solid #ECECF3',borderRadius:'16px',boxShadow:'0 20px 50px -12px rgba(30,27,46,.25)'}}
            >
              {/* User info header */}
              <div style={{padding:'14px 16px 12px',borderBottom:'1px solid #F1EFF7'}}>
                <div style={{fontWeight:700,fontSize:'13.5px',color:'#1E1B2E'}}>{meData?.name ?? userName}</div>
                <div style={{fontSize:'11.5px',color:'#8b88a0',fontWeight:500,marginTop:'1px'}}>{meData?.email ?? 'Creator'}</div>
              </div>
              {/* Menu items */}
              <div style={{padding:'6px'}}>
                {BOTTOM_ITEMS.map(({ href, icon: Icon, label }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 transition-colors"
                    style={{padding:'9px 10px',borderRadius:'10px',fontSize:'13px',fontWeight:500,textDecoration:'none',color:'#3d3a52'}}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#F6F5FC'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; }}
                  >
                    <Icon style={{width:'16px',height:'16px',flexShrink:0,color:'#7C3AED',opacity:.85}} />
                    {label}
                  </Link>
                ))}
              </div>
              {/* Sign out */}
              <div style={{padding:'0 6px 6px',borderTop:'1px solid #F1EFF7',marginTop:'2px',paddingTop:'6px'}}>
                <button
                  type="button"
                  onClick={() => { setUserMenuOpen(false); void handleLogout(); }}
                  className="flex items-center gap-2.5 w-full border-none cursor-pointer transition-colors"
                  style={{padding:'9px 10px',borderRadius:'10px',fontSize:'13px',fontWeight:500,background:'transparent',color:'#ef4444',fontFamily:'inherit',width:'100%'}}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#FEF2F2'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; }}
                >
                  <LogOut style={{width:'16px',height:'16px',flexShrink:0}} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── BODY: sidebar + main ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
        <aside
          className="flex flex-col shrink-0 overflow-hidden transition-[width] duration-[320ms] ease-[cubic-bezier(.4,0,.2,1)]"
          style={{ background:'linear-gradient(185deg,#7C3AED 0%,#5B21B6 100%)', width: sidebarCollapsed ? '62px' : '244px', WebkitFontSmoothing:'antialiased', MozOsxFontSmoothing:'grayscale' } as React.CSSProperties}
        >
          {/* ── Logo header ── */}
          <div
            className="flex items-center shrink-0"
            style={{
              height:'62px',
              padding: sidebarCollapsed ? '0' : '0 16px',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              gap:'11px',
              borderBottom:'1px solid rgba(255,255,255,.10)',
            }}
          >
            <LogoMark className="shrink-0" style={{ width:'34px', height:'34px', borderRadius:'9px', border:'1.5px solid rgba(255,255,255,.28)', boxShadow:'0 3px 10px rgba(0,0,0,.28)' }} />
            {!sidebarCollapsed && (
              <div style={{ overflow:'hidden', lineHeight:1.35 }}>
                <div style={{ fontWeight:800, fontSize:'16px', color:'#fff', letterSpacing:'-.4px', whiteSpace:'nowrap' }}>Blueforce</div>
                <div style={{ fontSize:'11px', color:'rgba(255,255,255,.48)', fontWeight:500, letterSpacing:'.15px', whiteSpace:'nowrap' }}>AI Content Platform</div>
              </div>
            )}
          </div>

          {/* ── Nav ── */}
          <nav
            className="flex-1 overflow-hidden"
            style={{ padding:'10px 10px' }}
          >
            {NAV_SECTIONS.map(({ category, items }, si) => {
              const isCollapsible = !!category && category !== 'Studio';
              const isOpen = !isCollapsible || sidebarCollapsed || openSections.has(category!);
              return (
                <div key={si} style={{ marginBottom: sidebarCollapsed ? '4px' : '4px' }}>
                  {/* Category header */}
                  {category && !sidebarCollapsed && (
                    isCollapsible ? (
                      <button
                        type="button"
                        onClick={() => toggleSection(category)}
                        className="flex items-center w-full border-none cursor-pointer"
                        style={{
                          gap:'6px',
                          padding:'10px 12px 6px',
                          background:'transparent',
                          fontSize:'11.5px',
                          fontWeight:600,
                          letterSpacing:'-.1px',
                          color:'rgba(255,255,255,.55)',
                          fontFamily:'inherit',
                          transition:'color 150ms ease',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color='rgba(255,255,255,.90)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color='rgba(255,255,255,.55)'; }}
                      >
                        <span style={{ flex:'1 1 auto', textAlign:'left' }}>{category}</span>
                        <ChevronDown style={{
                          width:'14px', height:'14px', flexShrink:0,
                          transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                          transition:'transform 220ms ease',
                        }} />
                      </button>
                    ) : (
                      <div style={{
                        fontSize:'11.5px', fontWeight:600, letterSpacing:'-.1px',
                        color:'rgba(255,255,255,.40)', padding:'10px 12px 6px',
                      }}>
                        {category}
                      </div>
                    )
                  )}
                  {/* Items */}
                  {isOpen && (
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                      {items.map(({ href, icon: Icon, label, badge, action }) => {
                        const isActive = !action && (pathname === href || pathname.startsWith(href + '/'));
                        const itemStyle: React.CSSProperties = {
                          gap:'11px',
                          padding: sidebarCollapsed ? '11px 0' : '9px 12px',
                          borderRadius:'11px',
                          fontSize:'14px',
                          fontWeight: isActive ? 600 : 500,
                          letterSpacing: isActive ? '-.15px' : '-.05px',
                          textDecoration:'none',
                          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                          background: isActive ? 'rgba(255,255,255,.92)' : 'transparent',
                          color: isActive ? '#6D28D9' : 'rgba(255,255,255,.78)',
                          transition:'background 180ms ease, color 180ms ease',
                          boxShadow: isActive ? '0 2px 8px rgba(0,0,0,.15)' : 'none',
                        };
                        const inner = (
                          <>
                            <Icon style={{ width:'18px', height:'18px', flexShrink:0, opacity: isActive ? 1 : 0.78, color: isActive ? '#7C3AED' : 'inherit' }} />
                            {!sidebarCollapsed && (
                              <>
                                <span style={{ flex:'1 1 auto', whiteSpace:'nowrap', overflow:'hidden' }}>{label}</span>
                                {badge && (
                                  <span style={{
                                    fontSize:'10px', fontWeight:700, letterSpacing:'.3px', textTransform:'uppercase',
                                    padding:'2px 7px', borderRadius:'99px', flexShrink:0, color:'#fff',
                                    background:
                                      badge === 'NEW'  ? 'linear-gradient(135deg,#10B981,#059669)' :
                                      badge === 'BETA' ? 'linear-gradient(135deg,#F59E0B,#D97706)' :
                                      badge === 'AI'   ? 'rgba(255,255,255,.22)' :
                                                        'linear-gradient(135deg,#6366F1,#4F46E5)',
                                  }}>
                                    {badge}
                                  </span>
                                )}
                              </>
                            )}
                          </>
                        );
                        const hoverOn  = (e: React.MouseEvent) => { if (!isActive) { const el = e.currentTarget as HTMLElement; el.style.background='rgba(255,255,255,.13)'; el.style.color='#fff'; } };
                        const hoverOff = (e: React.MouseEvent) => { if (!isActive) { const el = e.currentTarget as HTMLElement; el.style.background='transparent'; el.style.color='rgba(255,255,255,.78)'; } };
                        return action ? (
                          <button
                            key={href}
                            type="button"
                            title={sidebarCollapsed ? label : undefined}
                            onClick={action}
                            className="flex items-center w-full border-none cursor-pointer"
                            style={{ ...itemStyle, fontFamily:'inherit' }}
                            onMouseEnter={hoverOn}
                            onMouseLeave={hoverOff}
                          >
                            {inner}
                          </button>
                        ) : (
                          <Link
                            key={href}
                            href={href}
                            title={sidebarCollapsed ? label : undefined}
                            className="flex items-center"
                            style={itemStyle}
                            onMouseEnter={hoverOn}
                            onMouseLeave={hoverOff}
                          >
                            {inner}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

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
