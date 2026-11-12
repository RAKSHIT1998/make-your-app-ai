import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import { Providers } from './providers';
import { themeBootScript } from '@/lib/theme';

export const metadata: Metadata = {
  title: { default: 'Make Your App AI — Build Anything. From Anywhere.', template: '%s · Make Your App AI' },
  description: 'Describe your idea and get a working website, app or online store you own.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FAFAF9' }, { media: '(prefers-color-scheme: dark)', color: '#0A0A09' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
