'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Lightbulb, FolderOpen, CheckSquare, Activity, Settings, LogOut, Zap, BarChart2, Layers, Palette } from 'lucide-react';

const NAV = [
  { href: '/discover', icon: Lightbulb, label: 'Discover' },
  { href: '/projects', icon: FolderOpen, label: 'Projects' },
  { href: '/approvals', icon: CheckSquare, label: 'Approvals' },
  { href: '/jobs', icon: Activity, label: 'Jobs' },
  { href: '/assets', icon: Layers, label: 'Assets' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/brand-kit', icon: Palette, label: 'Brand Kit' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!localStorage.getItem('cf_token')) {
      router.push('/login');
    }
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('cf_token');
    router.push('/login');
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-5 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-brand-600" />
            <span className="font-bold text-lg text-gray-900">AI CreatorForce</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">AI Content Platform</p>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-3">
          {NAV.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname.startsWith(href)
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 w-full"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
