'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '../logo';
import { Button, cx } from '../ui';
import { useAuth } from '@/lib/auth';

/** Header for public pages (Explore, project pages, creator profiles, pricing). */
export function PublicHeader() {
  const { session } = useAuth();
  const path = usePathname();
  const link = (href: string, label: string) => <Link href={href} className={cx('rounded-[var(--radius-md)] px-2.5 py-1.5 text-sm transition-colors hover:text-fg', path.startsWith(href) ? 'text-fg' : 'text-muted')}>{label}</Link>;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href={session ? '/home' : '/explore'} aria-label="Make Your App AI" className="mr-2"><Logo compact className="sm:hidden" /><Logo className="hidden sm:inline-flex" /></Link>
        <nav className="flex items-center">{link('/explore', 'Explore')}{link('/pricing', 'Pricing')}</nav>
        <div className="ml-auto">{session ? <Link href="/home"><Button size="sm" variant="secondary">Open app</Button></Link> : <Link href="/login"><Button size="sm">Start building</Button></Link>}</div>
      </div>
    </header>
  );
}

export function MadeWith() {
  return (
    <Link href="/explore" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted shadow-sm hover:text-fg">
      <span className="size-1.5 rounded-full bg-accent" />Made with Make Your App AI
    </Link>
  );
}
