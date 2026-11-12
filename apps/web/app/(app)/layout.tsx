'use client';

import { clsx } from 'clsx';
import { CreditCard, FolderKanban, Home, LayoutTemplate, PlusCircle, Rocket, Server, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Logo } from '@/components/logo';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const NAV = [
  { href: '/home', label: 'Home', icon: Home, live: true },
  { href: '/create', label: 'Create', icon: PlusCircle, live: true },
  { href: '/projects', label: 'Projects', icon: FolderKanban, live: true },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate, live: false },
  { href: '/hosting', label: 'Hosting', icon: Server, live: false },
  { href: '/publish', label: 'Publish', icon: Rocket, live: false },
  { href: '/billing', label: 'Billing', icon: CreditCard, live: false },
  { href: '/settings', label: 'Settings', icon: Settings, live: true },
];
const MOBILE_NAV = NAV.filter((n) => ['/home', '/create', '/projects', '/settings'].includes(n.href));

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const credits = useQuery({ queryKey: ['credits'], queryFn: api.credits, enabled: !!session });

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <Link href="/home" className="px-2"><Logo /></Link>
        <nav className="mt-8 flex flex-1 flex-col gap-0.5" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon, live }) =>
            live ? (
              <Link key={href} href={href} className={clsx('flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors', pathname.startsWith(href) ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-muted hover:text-fg')}>
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ) : (
              <span key={href} className="flex cursor-default items-center gap-3 px-3 py-2 text-sm text-subtle" title="Coming in a later release">
                <Icon className="size-4" aria-hidden />
                {label}
                <span className="ml-auto rounded-full bg-surface-muted px-2 py-0.5 text-[11px]">Soon</span>
              </span>
            ),
          )}
        </nav>
        <div className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-2.5 text-sm">
          <div className="text-muted">Credits</div>
          <div className="font-semibold">{credits.data ? credits.data.balance.toLocaleString() : '—'}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-bg/90 px-4 backdrop-blur md:hidden">
          <Logo />
          <span className="ml-auto text-sm text-muted">{credits.data ? `${credits.data.balance} credits` : ''}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={clsx('flex flex-col items-center gap-1 py-2.5 text-xs font-medium', pathname.startsWith(href) ? 'text-brand' : 'text-muted')}>
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
