'use client';

import type { ProjectType } from '@mya/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Compass, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { PublicHeader } from '@/components/growth/public-header';
import { ShowcaseCard } from '@/components/growth/showcase-card';
import { Button, Card, cx, EmptyState, ErrorNotice, Input, Segmented, Select, Skeleton } from '@/components/ui';
import { CATEGORIES, CATEGORY_LABELS, community, showcase, type Category, type ExploreQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const SORTS = [{ value: 'trending', label: 'Trending' }, { value: 'recent', label: 'New' }, { value: 'popular', label: 'Most liked' }, { value: 'featured', label: 'Featured' }] as const;
const TYPES: { value: ProjectType | ''; label: string }[] = [{ value: '', label: 'All types' }, { value: 'website', label: 'Websites' }, { value: 'business_website', label: 'Business websites' }, { value: 'ecommerce', label: 'Online stores' }, { value: 'mobile_app', label: 'Mobile apps' }, { value: 'saas', label: 'SaaS' }];

export default function ExplorePage() {
  const { session } = useAuth();
  const [sort, setSort] = useState<NonNullable<ExploreQuery['sort']> | 'following'>('trending');
  const [q, setQ] = useState('');
  const [type, setType] = useState<ProjectType | ''>('');
  const [category, setCategory] = useState<Category | ''>('');
  const dq = useDeferredValue(q.trim());
  const list = useInfiniteQuery({
    queryKey: ['explore', sort, dq, type, category],
    enabled: sort !== 'following' || !!session,
    queryFn: ({ pageParam }) => sort === 'following' ? community.feed(pageParam) : showcase.explore({ sort, q: dq || undefined, type: type || undefined, category: category || undefined, page: pageParam, limit: 24 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = sort !== 'following' && !!(dq || type || category);
  const following = sort === 'following';
  type SortKey = NonNullable<ExploreQuery['sort']> | 'following';
  const sortOptions: { value: SortKey; label: string }[] = session ? [...SORTS, { value: 'following', label: 'Following' }] : [...SORTS];

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Explore what people are building</h1>
          <p className="mt-2 text-muted">Real projects made with Make Your App AI. Open one to see how it&apos;s put together, or remix it into your own.</p>
        </div>

        <div className="mt-8 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search projects" placeholder="Search projects or @creators" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select aria-label="Project type" value={type} onChange={(e) => setType(e.target.value as ProjectType | '')} className="sm:w-48">{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
            <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category | '')} className="sm:w-44"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</Select>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:ml-auto lg:px-0"><Segmented<SortKey> label="Sort" value={sort} onChange={setSort} options={sortOptions} /></div>
        </div>

        <div className="mt-6">
          {list.error ? <ErrorNotice error={list.error} onRetry={() => list.refetch()} /> : !list.data ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-72 rounded-[var(--radius-lg)]" />)}</div>
          ) : items.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={<Compass className="size-5" />}
                title={following ? 'Nothing from people you follow yet' : filtered ? 'No projects match' : sort === 'featured' ? 'Nothing featured yet' : 'No public projects yet'}
                body={following ? 'Follow creators from their profile and their newest projects will show up here.' : filtered ? 'Try a different search or filter.' : 'Be one of the first — build something and publish it from your project’s Share menu.'}
                action={!filtered && <Link href={session ? '/create' : '/login'}><Button>Start building</Button></Link>}
              />
            </Card>
          ) : (
            <>
              <div className={cx('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', list.isFetching && !list.isFetchingNextPage && 'opacity-60 transition-opacity')}>{items.map((i) => <ShowcaseCard key={i.slug} item={i} />)}</div>
              {list.hasNextPage && <div className="mt-8 flex justify-center"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button></div>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
