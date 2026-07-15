'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Menu, X, Zap } from 'lucide-react';

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Download', href: '#download' },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <div ref={menuRef} className="md:hidden">
      <button
        type="button"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
      >
        {open ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
      </button>

      {open && (
        <div
          id="mobile-menu"
          role="dialog"
          aria-label="Navigation menu"
          className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#9d6ff0] to-[#7c4fd8] px-6 pt-5 pb-8"
        >
          {/* Top row in overlay */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow">
                <Zap className="w-5 h-5 text-brand-600" />
              </div>
              <span className="font-bold text-white text-lg">AI CreatorForce</span>
            </div>
            <button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          <nav aria-label="Mobile navigation">
            <ul className="space-y-1">
              {NAV_LINKS.map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3.5 rounded-xl text-white/90 text-lg font-medium hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-auto flex flex-col gap-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="w-full py-3.5 text-center rounded-xl text-white/90 font-semibold border border-white/30 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="w-full py-3.5 text-center rounded-xl bg-white text-brand-600 font-bold shadow hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
            >
              Get started free
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
