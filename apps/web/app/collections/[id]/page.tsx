'use client';

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Bookmark, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PublicHeader } from '@/components/growth/public-header';
import { ShowcaseCard } from '@/components/growth/showcase-card';
import { Button, Card, EmptyState, ErrorNotice, Skeleton, toast } from '@/components/ui';
import { ApiError, community } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const { loading, session } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['collection', id, !!session], queryFn: () => community.collection(id), enabled: !loading, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const drop = useMutation({ mutationFn: (slug: string) => community.setItem(id, slug, false), onSuccess: () => void qc.invalidateQueries({ queryKey: ['collection', id] }), onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        {q.error ? (q.error instanceof ApiError && q.error.status === 404
          ? <Card padded={false}><EmptyState icon={<Bookmark className="size-5" />} title="Collection not found" body="It may be private or no longer exist." action={<Link href="/explore"><Button variant="secondary">Explore projects</Button></Link>} /></Card>
          : <ErrorNotice error={q.error} onRetry={() => q.refetch()} />)
          : !q.data ? <Skeleton className="h-40" /> : (
            <>
              <p className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">Collection{q.data.isPublic ? '' : ' · private'}</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">{q.data.name}</h1>
              {q.data.description && <p className="mt-2 max-w-2xl text-muted">{q.data.description}</p>}
              <p className="mt-2 text-sm text-muted">Curated by {q.data.owner.handle ? <Link className="font-medium text-fg hover:underline" href={`/c/${q.data.owner.handle}`}>{q.data.owner.name}</Link> : q.data.owner.name}</p>
              <div className="mt-8">
                {q.data.items.length === 0 ? <Card padded={false}><EmptyState compact icon={<Bookmark className="size-5" />} title="Nothing here yet" body="Projects that are unpublished disappear from collections automatically." /></Card> : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {q.data.items.map((i) => (
                      <div key={i.slug} className="relative">
                        <ShowcaseCard item={i} />
                        {q.data.mine && <button type="button" aria-label={`Remove ${i.title} from collection`} onClick={() => drop.mutate(i.slug)} className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-surface/90 text-muted shadow-sm ring-1 ring-border hover:text-fg"><X className="size-4" /></button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
      </main>
    </div>
  );
}
