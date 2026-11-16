'use client';

import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import Link from 'next/link';
import { PublicHeader } from '@/components/growth/public-header';
import { Button, Card, EmptyState, ErrorNotice, Skeleton } from '@/components/ui';
import { challenges } from '@/lib/api';

export default function LeaderboardPage() {
  const q = useQuery({ queryKey: ['leaderboard-creators'], queryFn: challenges.creators });
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-10 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Top creators</h1>
        <p className="mt-2 max-w-2xl text-muted">The last 30 days. Each like from someone else is 1 point, each remix by someone else 3, and each top-three challenge finish 10.</p>
        <div className="mt-8">
          {q.error ? <ErrorNotice error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-64" /> : q.data.length === 0 ? (
            <Card><EmptyState icon={<Trophy className="size-5" />} title="Nobody on the board yet" body="Publish a project and share it: likes and remixes from others put you here." action={<Link href="/challenges"><Button size="sm" variant="secondary">See challenges</Button></Link>} /></Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted"><th className="px-4 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">Creator</th><th className="px-4 py-3 text-right font-medium">Likes</th><th className="px-4 py-3 text-right font-medium">Remixes</th><th className="px-4 py-3 text-right font-medium">Podiums</th><th className="px-4 py-3 text-right font-medium">Points</th></tr></thead>
                <tbody>
                  {q.data.map((r) => (
                    <tr key={r.handle} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-semibold tabular-nums">{r.rank}</td>
                      <td className="px-4 py-3"><Link href={`/c/${r.handle}`} className="font-medium hover:underline">{r.name}</Link><span className="ml-1.5 text-muted">@{r.handle}</span></td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.likes}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.remixes}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.podiums}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
