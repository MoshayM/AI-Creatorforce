import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://aicreatorforce.net';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'AI CreatorForce', template: '%s · AI CreatorForce' },
  description: 'Turn long videos into publish-ready YouTube Shorts, edit with a full timeline, and publish — AI-assisted end to end.',
  applicationName: 'AI CreatorForce',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'AI CreatorForce',
    title: 'AI CreatorForce — AI YouTube Content Platform',
    description: 'Turn long videos into publish-ready Shorts, edit with a full timeline, and publish — AI-assisted end to end.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI CreatorForce',
    description: 'AI-powered YouTube content creation platform.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
