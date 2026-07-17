'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

// Channel access now lives inside Media Control (/library?tab=channels).
// This stub keeps old links and OAuth callback URLs working, preserving
// query params like ?connected=true / ?error=... for the banner logic.
export default function ChannelAccessRedirect() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>}>
      <RedirectInner />
    </Suspense>
  );
}

function RedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'channels');
    router.replace(`/library?${params.toString()}`);
  }, [router, searchParams]);
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
    </div>
  );
}
