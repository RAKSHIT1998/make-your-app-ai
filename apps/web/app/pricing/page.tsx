'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { PlanCards } from '@/components/plan-cards';
import { Button, ErrorNotice, Skeleton } from '@/components/ui';
import { billing } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LEGAL, LEGAL_SLUGS } from '@/lib/legal';

const FAQ: [string, string][] = [
  ['What is an AI credit?', 'Credits measure AI work. Generating or editing a project uses credits based on how much the AI actually processed, and every run shows what it used.'],
  ['What happens if I run out?', 'AI changes pause until your allowance resets or you buy a top-up. Your projects, code and stores keep working.'],
  ['Can I cancel anytime?', 'Yes. You keep your plan until the end of the paid period, then move to Free. Your projects are kept.'],
  ['What does “soon” mean on a plan?', "Those features aren't available yet. We list them so you know what's planned, and they're clearly marked until they ship."],
];

export default function PricingPage() {
  const { session } = useAuth();
  const router = useRouter();
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: billing.catalogue });
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Home"><Logo /></Link>
          <Link href={session ? '/home' : '/login'}><Button size="sm" variant={session ? 'secondary' : 'primary'}>{session ? 'Open app' : 'Sign in'}</Button></Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">Simple plans. Honest limits.</h1>
          <p className="mt-4 text-muted sm:text-lg">Start free. Upgrade when you&apos;re ready to launch.</p>
        </div>
        {catalogue.error ? <ErrorNotice error={catalogue.error} onRetry={() => catalogue.refetch()} /> : !catalogue.data ? <Skeleton className="h-96" /> : (
          <PlanCards catalogue={catalogue.data} onChoose={(price) => router.push(session ? `/billing?plan=${price.id}` : '/login')} />
        )}
        <section className="mx-auto mt-20 max-w-3xl">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">Questions</h2>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">{q}<span className="text-subtle transition-transform group-open:rotate-45">+</span></summary>
                <p className="mt-2 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© Make Your App AI</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">{LEGAL_SLUGS.map((s) => <Link key={s} href={`/legal/${s}`} className="hover:text-fg">{LEGAL[s]!.title}</Link>)}</nav>
        </div>
      </footer>
    </div>
  );
}
