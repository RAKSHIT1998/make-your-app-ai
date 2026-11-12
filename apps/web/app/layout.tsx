import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { themeBootScript } from '@/lib/theme';

export const metadata: Metadata = {
  title: { default: 'Make Your App AI', template: '%s · Make Your App AI' },
  description: 'Build Anything. From Anywhere. Create websites, apps and software by describing them.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
