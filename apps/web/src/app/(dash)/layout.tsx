'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, CheckSquare, Settings, LogOut, Zap, Palette, Clapperboard, ListVideo, Wallet, Gift, Bell, Gauge, Building2, ChevronDown, Workflow, Film, Menu, X, CalendarClock, Sparkles } from 'lucide-react';
import { CopilotPanel } from '@/components/copilot-panel';
import { api, clearTokens, getRefreshToken, type AppNotification } from '@/lib/api';

interface NavItem {
  href: string;
  icon: typeof FolderOpen;
  label: string;
  /** Indented sub-links rendered directly beneath the item. */
  children?: NavItem[];
}

const NAV: NavItem[] = [
  { href: '/projects', icon: FolderOpen, label: 'Projects' },
  { href: '/shorts-studio', icon: Clapperboard, label: 'Shorts Studio' },
  { href: '/editor', icon: Film, label: 'Video Editor' },
  { href: '/approvals', icon: CheckSquare, label: 'Approvals' },
  { href: '/scheduler', icon: CalendarClock, label: 'Scheduler' },
  { href: '/autonomy', icon: Sparkles, label: 'Autonomy' },
  {
    href: '/settings',
    icon: Settings,
    label: 'Settings',
    children: [
      { href: '/library', icon: ListVideo, label: 'Media Control' },
      { href: '/wallet', icon: Wallet, label: 'Billing & Wallet' },
      { href: '/orgs', icon: Building2, label: 'Organization' },
      { href: '/growth', icon: Gift, label: 'Growth' },
      { href: '/brand-kit', icon: Palette, label: 'Brand Kit' },
      { href: '/automation', icon: Workflow, label: 'Automation' },
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
  /** Explicit expand/collapse choices per nav group; unset falls back to route-based auto-open. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  /** Mobile off-canvas sidebar (below lg the sidebar is a drawer). */
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    if (!localStorage.getItem('cf_token')) {
      router.push('/login');
      return;
    }
    setUserName(nameFromToken());
    // admin:revenue holders (ROLE_PERMISSIONS in the API): OWNER + SUPER_ADMIN
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

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

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
    <div className="min-h-screen bg-[#e9e1f8] p-3 md:p-5">
      <div className="dash-shell mx-auto max-w-[1500px] bg-white rounded-[2rem] shadow-xl flex h-[calc(100vh-2.5rem)] overflow-hidden">
        {/* Backdrop behind the mobile drawer */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/40"
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Sidebar: static column on lg+, off-canvas drawer below lg (design ref: ux.jpg) */}
        <aside
          className={`m-3 w-60 shrink-0 bg-gradient-to-b from-[#9d6ff0] to-[#7c4fd8] rounded-[1.75rem] flex flex-col text-white shadow-lg
            max-lg:fixed max-lg:inset-y-3 max-lg:left-3 max-lg:z-50 max-lg:transition-transform max-lg:duration-200
            ${sidebarOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-[110%]'}`}
        >
          <div className="px-5 pt-6 pb-4 relative">
            <button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden absolute top-4 right-4 flex items-center justify-center w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-md">
              <Zap className="w-7 h-7 text-brand-600" />
            </div>
            <p className="font-bold text-lg mt-3">AI CreatorForce</p>
            <p className="text-xs text-white/70">AI Content Platform</p>
          </div>
          <nav className="flex-1 py-2 space-y-1 px-3 overflow-y-auto">
            {[...NAV, ...(isAdmin ? [{
            href: '/admin',
            icon: Gauge,
            label: 'Admin',
          } as NavItem] : [])].map(({ href, icon: Icon, label, children }) => {
              // Groups open on click (chevron or navigating into the section)
              // and auto-open while the current page lives inside them.
              const groupActive =
                pathname.startsWith(href) ||
                (children?.some((c) => !c.href.includes('#') && pathname.startsWith(c.href)) ?? false);
              const open = openGroups[href] ?? groupActive;
              return (
              <div key={href}>
                <div className="relative">
                  <Link
                    href={href}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors ${
                      pathname.startsWith(href)
                        ? 'bg-white/20 text-white font-semibold shadow-sm'
                        : 'text-white/75 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                  {children && children.length > 0 && (
                    <button
                      type="button"
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${label} menu`}
                      aria-expanded={open}
                      onClick={() => setOpenGroups((g) => ({ ...g, [href]: !open }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
                    </button>
                  )}
                </div>
                {open && children?.map(({ href: subHref, icon: SubIcon, label: subLabel }) => (
                  <Link
                    key={subHref}
                    href={subHref}
                    className={`mt-1 flex items-center gap-2.5 pl-9 pr-4 py-2 rounded-xl text-[13px] transition-colors ${
                      !subHref.includes('#') && pathname.startsWith(subHref)
                        ? 'bg-white/20 text-white font-semibold shadow-sm'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <SubIcon className="w-3.5 h-3.5" />
                    {subLabel}
                  </Link>
                ))}
              </div>
              );
            })}
          </nav>
          <div className="p-3">
            <button
              onClick={() => { void handleLogout(); }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-white/75 hover:bg-white/10 hover:text-white w-full transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar: hamburger (mobile) + notification bell + user chip */}
          <div className="dash-topbar flex items-center justify-between lg:justify-end gap-3 px-4 lg:px-8 pt-5">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <Menu className="w-4 h-4 text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
            {/* ── Notification bell ───────────────────────────────────────────── */}
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                aria-haspopup="true"
                aria-expanded={bellOpen}
                onClick={() => { setBellOpen((o) => !o); if (!bellOpen) void fetchNotifications(); }}
                className="relative flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <Bell className="w-4 h-4 text-gray-600" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-[#9d6ff0] text-white text-[9px] font-bold leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div
                  role="dialog"
                  aria-label="Notifications"
                  className="absolute right-0 top-11 z-50 w-80 rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <span className="text-sm font-semibold text-gray-800">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => { void handleMarkAllRead(); }}
                        className="text-[11px] text-[#9d6ff0] hover:underline font-medium focus:outline-none"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  {/* List */}
                  <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                    {notifications.length === 0 ? (
                      <li className="px-4 py-6 text-center text-sm text-gray-500">No notifications yet</li>
                    ) : (
                      notifications.map((n) => (
                        <li key={n.id}>
                          <button
                            type="button"
                            onClick={() => { if (!n.readAt) void handleMarkRead(n.id); }}
                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 ${!n.readAt ? 'bg-purple-50/60' : ''}`}
                          >
                            <div className="flex items-start gap-2">
                              {!n.readAt && (
                                <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[#9d6ff0]" aria-hidden="true" />
                              )}
                              <div className={!n.readAt ? '' : 'pl-3.5'}>
                                <p className="text-[13px] font-semibold text-gray-800 leading-snug">{n.title}</p>
                                {n.body && (
                                  <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{n.body}</p>
                                )}
                                <p className="text-[10px] text-gray-500 mt-1">{relativeTime(n.createdAt)}</p>
                              </div>
                            </div>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* ── User chip ────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-b from-[#cbbcf2] to-[#a48fe0] flex items-center justify-center text-white text-sm font-bold uppercase">
                {userName.charAt(0)}
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-gray-800">{userName}</p>
                <p className="text-[11px] text-gray-500">Creator</p>
              </div>
            </div>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <CopilotPanel />
    </div>
  );
}
