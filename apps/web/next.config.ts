import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3007'] },
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
