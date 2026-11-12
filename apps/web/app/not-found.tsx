import Link from 'next/link';
import { Logo } from '@/components/logo';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Link href="/" aria-label="Make Your App AI"><Logo /></Link>
      <div>
        <p className="font-mono text-sm text-subtle">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">This page doesn’t exist</h1>
        <p className="mt-2 text-muted">It may have been moved, unpublished or never existed.</p>
      </div>
      <div className="flex gap-2">
        <Link href="/" className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover">Go home</Link>
        <Link href="/explore" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border bg-surface px-4 text-sm font-medium hover:border-border-strong">Explore projects</Link>
      </div>
    </main>
  );
}
