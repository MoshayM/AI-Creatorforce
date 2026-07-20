import type { NextConfig } from 'next';

// Security headers (docs4/14, docs4/23 app-side): the API already ships the
// helmet set; the web app must send its own. CSP allows exactly what the app
// uses — YouTube thumbnails, the configured API origin (+ its websocket), and
// blob previews for rendered media. Next's runtime requires inline scripts;
// eval is only allowed in dev where the toolchain needs it.
const apiOrigin = (() => {
  try {
    return new URL(process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api/v1').origin;
  } catch {
    return 'http://localhost:4007';
  }
})();
const wsOrigin = apiOrigin.replace(/^http/, 'ws');

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com https://yt3.googleusercontent.com",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  `media-src 'self' blob: ${apiOrigin}`,
  `connect-src 'self' ${apiOrigin} ${wsOrigin}${process.env['SENTRY_DSN'] ? ' https://*.sentry.io' : ''}`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ZAP baseline rule 10037: don't advertise the framework.
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3007'] },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'yt3.googleusercontent.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/proxy/:path*',
        destination: `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api/v1'}/:path*`,
      },
    ];
  },
};

// Wrap with Sentry only when DSN is configured (skip entirely in local dev without DSN)
let exportedConfig: NextConfig = nextConfig;
if (process.env['SENTRY_DSN']) {
  try {
    const { withSentryConfig } = require('@sentry/nextjs') as { withSentryConfig: (c: NextConfig, o: object) => NextConfig };
    exportedConfig = withSentryConfig(nextConfig, {
      silent: true,
      widenClientFileUpload: true,
      hideSourceMaps: true,
      disableLogger: true,
      automaticVercelMonitors: false,
    });
  } catch {
    // @sentry/nextjs not installed — fine
  }
}

export default exportedConfig;
