'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { PlanCards } from '@/components/plan-cards';
import { Button, ErrorNotice, Skeleton } from '@/components/ui';
import { billing } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function PricingPage() {
  const { session } = useAuth();
  const router = useRouter();
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: billing.catalogue });
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-12 flex items-center justify-between">
        <Link href="/"><Logo /></Link>
        <Link href={session ? '/home' : '/login'}><Button variant="secondary" size="sm">{session ? 'Open app' : 'Sign in'}</Button></Link>
      </header>
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Plans for every builder</h1>
        <p className="mt-3 text-muted">Start free. Upgrade when you&apos;re ready to launch.</p>
      </div>
      {catalogue.error ? <ErrorNotice error={catalogue.error} /> : !catalogue.data ? <Skeleton className="h-96" /> : (
        <PlanCards catalogue={catalogue.data} onChoose={(price) => router.push(session ? `/billing?plan=${price.id}` : '/login')} />
      )}
      <footer className="mt-16 flex flex-wrap justify-center gap-4 text-sm text-muted">
        {['terms', 'privacy', 'acceptable-use', 'refunds', 'subscriptions'].map((p) => <Link key={p} href={`/legal/${p}`} className="hover:text-fg">{p.replace('-', ' ').replace(/^./, (c) => c.toUpperCase())}</Link>)}
      </footer>
    </main>
  );
}
