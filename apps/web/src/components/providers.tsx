'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

const MOCK_MODE = process.env['NEXT_PUBLIC_USE_MOCK'] === 'true';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
      }),
  );

  // In mock mode we must wait for the MSW service worker to activate before
  // any fetch can be intercepted. `mockReady` gates rendering so no request
  // fires before MSW is live.
  // Skip MSW when running under Playwright (navigator.webdriver=true) — Playwright
  // installs its own page.route() interceptors, which MSW's service worker would shadow.
  const [mockReady, setMockReady] = useState(!MOCK_MODE);

  useEffect(() => {
    if (!MOCK_MODE) return;
    if (navigator.webdriver) {
      setMockReady(true);
      return;
    }
    void import('../mocks').then(({ initMocks }) =>
      initMocks().then(() => setMockReady(true)),
    );
  }, []);

  if (!mockReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Starting mock API…</div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
