export async function initMocks() {
  if (typeof window === 'undefined') return;
  if (process.env['NEXT_PUBLIC_USE_MOCK'] !== 'true') return;

  const { worker } = await import('./browser');
  await worker.start({
    onUnhandledRequest: 'warn',
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
}
