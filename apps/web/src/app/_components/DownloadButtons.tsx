'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Monitor, Smartphone, Globe, X } from 'lucide-react';

function ComingSoonToast({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3 bg-gray-900 text-white px-5 py-4 rounded-2xl shadow-2xl max-w-sm w-[calc(100vw-2rem)]"
    >
      <div className="flex-1 text-sm leading-snug">
        <p className="font-semibold mb-0.5">Desktop &amp; mobile apps on the way</p>
        <p className="text-gray-300">Use the web app now — it&apos;s fully featured.</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onClose}
        className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function DownloadButtons() {
  const [toastVisible, setToastVisible] = useState(false);

  function handleDownloadClick(e: React.MouseEvent) {
    e.preventDefault();
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 5000);
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch sm:items-start">
        {/* Windows card */}
        <div className="relative flex-1 max-w-xs w-full bg-white rounded-2xl shadow-lg border border-gray-100 p-6 flex flex-col items-center gap-4 mx-auto sm:mx-0">
          <span className="absolute -top-3 right-4 bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200">
            Coming soon
          </span>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#9d6ff0] to-[#7c4fd8] flex items-center justify-center shadow-md">
            <Monitor className="w-7 h-7 text-white" aria-hidden="true" />
          </div>
          <div className="text-center">
            <p className="font-bold text-gray-900 text-lg">Windows</p>
            <p className="text-sm text-gray-500 mt-1">Desktop app for Windows 10+</p>
          </div>
          <button
            type="button"
            onClick={handleDownloadClick}
            aria-label="Download AI CreatorForce for Windows (coming soon)"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] text-white font-semibold text-sm hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 transition-opacity min-h-[44px]"
          >
            Download for Windows
          </button>
        </div>

        {/* Android card */}
        <div className="relative flex-1 max-w-xs w-full bg-white rounded-2xl shadow-lg border border-gray-100 p-6 flex flex-col items-center gap-4 mx-auto sm:mx-0">
          <span className="absolute -top-3 right-4 bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200">
            Coming soon
          </span>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#9d6ff0] to-[#7c4fd8] flex items-center justify-center shadow-md">
            <Smartphone className="w-7 h-7 text-white" aria-hidden="true" />
          </div>
          <div className="text-center">
            <p className="font-bold text-gray-900 text-lg">Android</p>
            <p className="text-sm text-gray-500 mt-1">Native app for Android 10+</p>
          </div>
          <button
            type="button"
            onClick={handleDownloadClick}
            aria-label="Download AI CreatorForce for Android (coming soon)"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] text-white font-semibold text-sm hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 transition-opacity min-h-[44px]"
          >
            Get the Android app
          </button>
        </div>
      </div>

      {/* Web CTA */}
      <div className="mt-8 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl border-2 border-brand-600 text-brand-600 font-semibold hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 transition-colors min-h-[44px]"
        >
          <Globe className="w-4 h-4" aria-hidden="true" />
          Use in browser — no install needed
        </Link>
      </div>

      {toastVisible && <ComingSoonToast onClose={() => setToastVisible(false)} />}
    </>
  );
}
