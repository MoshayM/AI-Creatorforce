'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderOpen, CheckSquare, Settings, LogOut, Zap, Palette, Clapperboard } from 'lucide-react';

const NAV = [
  { href: '/projects', icon: FolderOpen, label: 'Projects' },
  { href: '/shorts-studio', icon: Clapperboard, label: 'Shorts Studio' },
  { href: '/approvals', icon: CheckSquare, label: 'Approvals' },
  { href: '/brand-kit', icon: Palette, label: 'Brand Kit' },
  { href: '/settings', icon: Settings, label: 'Settings' },
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

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState('Creator');

  useEffect(() => {
    if (!localStorage.getItem('cf_token')) {
      router.push('/login');
      return;
    }
    setUserName(nameFromToken());
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('cf_token');
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-[#e9e1f8] p-3 md:p-5">
      <div className="dash-shell mx-auto max-w-[1500px] bg-white rounded-[2rem] shadow-xl flex h-[calc(100vh-2.5rem)] overflow-hidden">
        {/* Rounded purple sidebar (design ref: ux.jpg) */}
        <aside className="m-3 w-60 shrink-0 bg-gradient-to-b from-[#9d6ff0] to-[#7c4fd8] rounded-[1.75rem] flex flex-col text-white shadow-lg">
          <div className="px-5 pt-6 pb-4">
            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-md">
              <Zap className="w-7 h-7 text-brand-600" />
            </div>
            <p className="font-bold text-lg mt-3">AI CreatorForce</p>
            <p className="text-xs text-white/70">AI Content Platform</p>
          </div>
          <nav className="flex-1 py-2 space-y-1 px-3 overflow-y-auto">
            {NAV.map(({ href, icon: Icon, label }) => (
              <Link
                key={href}
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
            ))}
          </nav>
          <div className="p-3">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-white/75 hover:bg-white/10 hover:text-white w-full transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar: user chip */}
          <div className="dash-topbar flex items-center justify-end gap-3 px-8 pt-5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-b from-[#cbbcf2] to-[#a48fe0] flex items-center justify-center text-white text-sm font-bold uppercase">
                {userName.charAt(0)}
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-gray-800">{userName}</p>
                <p className="text-[11px] text-gray-400">Creator</p>
              </div>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
