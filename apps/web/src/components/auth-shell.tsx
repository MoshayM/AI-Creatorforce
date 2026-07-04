'use client';
import React from 'react';

/**
 * Shared lavender "clay" shell for the auth pages (design ref: login.jpg —
 * soft purple scene, rounded panel, overlapping mascot, pill form card).
 */
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
      {/* Decorative clouds & shapes */}
      <div className="absolute top-16 left-[12%] w-24 h-10 bg-white/80 rounded-full blur-[1px]" />
      <div className="absolute top-24 left-[16%] w-14 h-8 bg-white/70 rounded-full" />
      <div className="absolute top-32 right-[14%] w-28 h-11 bg-white/80 rounded-full blur-[1px]" />
      <div className="absolute bottom-24 left-[8%] w-40 h-40 bg-[#9d8adf]/60 rounded-full" />
      <div className="absolute bottom-10 right-[6%] w-56 h-56 bg-[#a794e4]/50 rounded-full" />

      <div className="relative w-full max-w-md bg-[#f7f4fd] rounded-[3rem] shadow-2xl px-6 pt-10 pb-8">
        <p className="text-center text-[11px] font-semibold tracking-[0.25em] uppercase text-[#9d8adf] mb-3">{brand}</p>

        <div className="text-center">
          <span className="text-lg" aria-hidden>💜</span>
          <h1 className="text-3xl font-extrabold text-[#7b5ec7] mt-1">
            <span className="text-[#e8c14d] mr-2" aria-hidden>✦</span>
            {title}
            <span className="text-[#e8c14d] ml-2" aria-hidden>✦</span>
          </h1>
          <p className="text-sm text-gray-500 mt-2">{subtitle}</p>
        </div>

        {/* Mascot overlapping the form card */}
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

const SOCIALS = [
  {
    name: 'Google',
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
    svg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-gray-900" aria-hidden>
        <path d="M16.4 12.9c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.7c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-3.7zM14 5.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
      </svg>
    ),
  },
  {
    name: 'Facebook',
    svg: (
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#1877F2]" aria-hidden>
        <path d="M24 12c0-6.6-5.4-12-12-12S0 5.4 0 12c0 6 4.4 11 10.1 11.9v-8.4H7.1V12h3v-2.6c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4C19.6 23 24 18 24 12z" />
      </svg>
    ),
  },
];

export function SocialRow() {
  return (
    <div className="mt-5">
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="flex-1 h-px bg-gray-200" />
        or continue with
        <span className="flex-1 h-px bg-gray-200" />
      </div>
      <div className="flex justify-center gap-4 mt-3">
        {SOCIALS.map((s) => (
          <button
            key={s.name}
            type="button"
            disabled
            title={`${s.name} sign-in coming soon`}
            aria-label={`${s.name} sign-in (coming soon)`}
            className="w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center opacity-70 cursor-not-allowed"
          >
            {s.svg}
          </button>
        ))}
      </div>
    </div>
  );
}
