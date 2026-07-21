import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400','500','600','700','800'], variable: '--font-plus-jakarta' });

const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://aicreatorforce.net';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Blueforce', template: '%s · Blueforce' },
  description: 'Turn long videos into publish-ready YouTube Shorts, edit with a full timeline, and publish — AI-assisted end to end.',
  applicationName: 'Blueforce',
  alternates: { canonical: '/' },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Blueforce',
    title: 'Blueforce — AI YouTube Content Platform',
    description: 'Turn long videos into publish-ready Shorts, edit with a full timeline, and publish — AI-assisted end to end.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blueforce',
    description: 'AI-powered YouTube content creation platform.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={plusJakarta.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
