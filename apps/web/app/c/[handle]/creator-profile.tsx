'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { PublicHeader } from '@/components/growth/public-header';
import { ShowcaseCard } from '@/components/growth/showcase-card';
import { Button, Card, EmptyState, ErrorNotice, Skeleton, toast } from '@/components/ui';
import { ApiError, community, showcase, type Creator } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';

function FollowButton({ c }: { c: Creator }) {
  const { session } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const follow = useMutation({
    mutationFn: (on: boolean) => community.follow(c.handle, on),
    onSuccess: (r) => qc.setQueryData<Creator>(['creator', c.handle, !!session], (d) => d && { ...d, followedByMe: r.following, followers: r.followers }),
    onError: (e) => toast.error((e as Error).message),
  });
  if (c.isMe) return null;
  return (
    <Button variant={c.followedByMe ? 'secondary' : 'primary'} size="sm" loading={follow.isPending} aria-pressed={c.followedByMe}
      onClick={() => (session ? follow.mutate(!c.followedByMe) : router.push(`/login?next=${encodeURIComponent(`/c/${c.handle}`)}`))}>
      {c.followedByMe ? 'Following' : 'Follow'}
    </Button>
  );
}

export function CreatorProfile({ handle }: { handle: string }) {
  const { loading, session } = useAuth();
  const c = useQuery({ queryKey: ['creator', handle, !!session], queryFn: () => showcase.creator(handle), enabled: !loading, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        {c.error ? (c.error instanceof ApiError && c.error.status === 404 ? <Card padded={false}><EmptyState title="Creator not found" action={<Link href="/explore"><Button variant="secondary">Explore projects</Button></Link>} /></Card> : <ErrorNotice error={c.error} />)
          : !c.data ? <Skeleton className="h-40" /> : (
            <>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface-muted text-2xl font-semibold uppercase">{c.data.name.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold tracking-[-0.02em]">{c.data.name}</h1>
                  <div className="text-sm text-muted">@{c.data.handle} · joined {new Date(c.data.joinedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</div>
                  {c.data.bio && <p className="mt-2 max-w-xl text-sm">{c.data.bio}</p>}
                </div>
                {c.data.isMe ? <Link href="/settings"><Button variant="secondary" size="sm">Edit profile</Button></Link> : <FollowButton c={c.data} />}
              </div>
              <dl className="mt-6 flex gap-8 text-sm">
                {([['Projects', c.data.totals.projects], ['Followers', c.data.followers], ['Likes', c.data.totals.likes], ['Remixes', c.data.totals.remixes]] as const).map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}
              </dl>
              <div className="mt-8">
                {c.data.projects.length === 0 ? <Card padded={false}><EmptyState compact icon={<FolderKanban className="size-5" />} title="No public projects yet" /></Card>
                  : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{c.data.projects.map((p) => <ShowcaseCard key={p.slug} item={p} />)}</div>}
              </div>
            </>
          )}
      </main>
    </div>
  );
}
