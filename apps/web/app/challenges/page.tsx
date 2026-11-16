'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Gift, Trophy } from 'lucide-react';
import Link from 'next/link';
import { PublicHeader } from '@/components/growth/public-header';
import { PhaseBadge, nextDeadline, typesText } from '@/components/growth/challenge-bits';
import { Button, Card, EmptyState, ErrorNotice, Skeleton } from '@/components/ui';
import { challenges, type ChallengeSummary } from '@/lib/api';

function ChallengeCard({ c, big }: { c: ChallengeSummary; big?: boolean }) {
  return (
    <Link href={`/challenges/${c.slug}`} className="group block rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">
      <div className="flex flex-wrap items-center gap-2"><PhaseBadge phase={c.phase} /><span className="text-xs text-muted">{nextDeadline(c)}</span></div>
      <h2 className={big ? 'mt-3 text-2xl font-semibold tracking-[-0.02em]' : 'mt-3 text-lg font-semibold'}>{c.title}</h2>
      <p className={big ? 'mt-2 line-clamp-3 text-muted' : 'mt-1 line-clamp-2 text-sm text-muted'}>{c.brief}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
        <span className="tabular-nums">{c.entries} {c.entries === 1 ? 'entry' : 'entries'}</span>
        <span>{typesText(c.projectTypes)}</span>
        {c.prize && <span className="inline-flex items-center gap-1 text-fg"><Gift className="size-3.5 text-accent" />{c.prize}</span>}
        <span className="ml-auto inline-flex items-center gap-1 font-medium text-fg group-hover:underline">View<ArrowRight className="size-3.5" /></span>
      </div>
    </Link>
  );
}

export default function ChallengesPage() {
  const q = useQuery({ queryKey: ['challenges'], queryFn: challenges.list });
  const d = q.data;
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Weekly challenges</h1>
            <p className="mt-2 text-muted">A new brief to build to. Enter something you&apos;ve published, vote for your favourites, and the top three win.</p>
          </div>
          <Link href="/leaderboard"><Button variant="secondary" size="sm"><Trophy className="size-4" />Top creators</Button></Link>
        </div>
        <div className="mt-8 space-y-10">
          {q.error ? <ErrorNotice error={q.error} onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-48 rounded-[var(--radius-lg)]" /> : !d.enabled ? (
            <Card><EmptyState icon={<Trophy className="size-5" />} title="Challenges are paused" body="Check back soon." /></Card>
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Running now</h2>
                {d.current.length ? <div className="grid gap-4 lg:grid-cols-2">{d.current.map((c) => <ChallengeCard key={c.slug} c={c} big />)}</div> : (
                  <Card><EmptyState compact icon={<Trophy className="size-5" />} title="No challenge is running right now" body={d.upcoming.length ? 'The next one is below.' : 'The next one will be announced here.'} action={<Link href="/explore"><Button size="sm" variant="secondary">Explore projects</Button></Link>} /></Card>
                )}
              </section>
              {d.upcoming.length > 0 && (
                <section className="space-y-3"><h2 className="text-sm font-medium uppercase tracking-wide text-muted">Coming up</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.upcoming.map((c) => <ChallengeCard key={c.slug} c={c} />)}</div></section>
              )}
              {d.past.length > 0 && (
                <section className="space-y-3"><h2 className="text-sm font-medium uppercase tracking-wide text-muted">Past challenges</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.past.map((c) => <ChallengeCard key={c.slug} c={c} />)}</div></section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
