'use client';

import { Player } from '@/components/growth/player';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, FileCode2, Flag, GitFork, Heart, Layers, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { MadeWith, PublicHeader } from '@/components/growth/public-header';
import { PalettePreview, ShowcaseCard } from '@/components/growth/showcase-card';
import { ShareButtons } from '@/components/growth/share';
import { projectTypeOption } from '@/components/project-types';
import { Badge, Button, Card, EmptyState, ErrorNotice, Skeleton, SoonBadge, toast, useConfirm } from '@/components/ui';
import { ApiError, CATEGORY_LABELS, showcase, type ShowcasePage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Comments } from '@/components/growth/comments';
import { SaveToCollection } from '@/components/growth/save-to-collection';

const REPORT_REASONS = 'spam, abuse, copyright, illegal, impersonation or other';

export function ProjectPublic({ slug }: { slug: string }) {
  const { session, loading } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const confirm = useConfirm();
  const page = useQuery({ queryKey: ['showcase', slug, !!session], queryFn: () => showcase.page(slug), enabled: !loading, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const viewed = useRef(false);
  useEffect(() => {
    if (page.data && !viewed.current) { viewed.current = true; void showcase.view(slug).catch(() => undefined); }
  }, [page.data, slug]);

  const like = useMutation({
    mutationFn: (on: boolean) => showcase.like(slug, on),
    onMutate: (on) => qc.setQueryData<ShowcasePage>(['showcase', slug, true], (d) => d && { ...d, likedByMe: on, likes: d.likes + (on ? 1 : -1) }),
    onSuccess: (r) => qc.setQueryData<ShowcasePage>(['showcase', slug, true], (d) => d && { ...d, likedByMe: r.liked, likes: r.likes }),
    onError: (e) => { toast.error((e as Error).message); void page.refetch(); },
  });
  const remix = useMutation({
    mutationFn: () => showcase.remix(slug),
    onSuccess: (p) => { toast.success('Remix created — it’s your project now'); router.push(`/projects/${p.id}`); },
    onError: (e) => toast.error((e as Error).message),
  });
  const report = useMutation({
    mutationFn: ({ reason, details }: { reason: string; details: string }) => showcase.report(slug, reason, details),
    onSuccess: (r) => toast.success(r.duplicate ? 'You’ve already reported this project' : 'Thanks — a moderator will review it'),
    onError: (e) => toast.error((e as Error).message),
  });
  const needLogin = () => router.push(`/login?next=${encodeURIComponent(`/p/${slug}`)}`);

  if (page.error) {
    return (
      <div className="min-h-dvh"><PublicHeader />
        <main className="mx-auto max-w-3xl px-4 py-16">
          {page.error instanceof ApiError && page.error.status === 404
            ? <Card padded={false}><EmptyState title="This project isn’t public" body="It may have been unpublished by its creator." action={<Link href="/explore"><Button variant="secondary">Explore projects</Button></Link>} /></Card>
            : <ErrorNotice error={page.error} onRetry={() => page.refetch()} />}
        </main>
      </div>
    );
  }
  const p = page.data;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/p/${slug}` : `/p/${slug}`;
  const type = p ? projectTypeOption(p.type) : undefined;

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        {!p ? <Skeleton className="h-[480px] rounded-[var(--radius-xl)]" /> : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-8">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  {type && <span>{type.label}</span>}
                  {p.category && <><span>·</span><span>{CATEGORY_LABELS[p.category]}</span></>}
                  {p.featured && <Badge tone="accent">Featured</Badge>}
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{p.title}</h1>
                {p.description && <p className="mt-3 max-w-2xl text-[15px] text-muted">{p.description}</p>}
                <Link href={`/c/${p.creator.handle}`} className="mt-4 inline-flex items-center gap-2.5 text-sm hover:underline">
                  <span className="flex size-7 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold uppercase">{(p.creator.name ?? '?').slice(0, 1)}</span>
                  <span><span className="font-medium">{p.creator.name}</span> <span className="text-muted">@{p.creator.handle}</span></span>
                </Link>
                {p.remixedFrom && (
                  <div className="mt-3 flex items-center gap-1.5 text-[13px] text-muted"><GitFork className="size-3.5" />
                    {'private' in p.remixedFrom ? 'Remixed from a project that is no longer public' : <>Remixed from <Link className="font-medium text-fg hover:underline" href={`/p/${p.remixedFrom.slug}`}>{p.remixedFrom.title}</Link> by @{p.remixedFrom.creator.handle}</>}
                  </div>
                )}
              </div>

              {p.playable ? (
                <Card padded={false} className="overflow-hidden">
                  <Player slug={p.slug} title={p.title} poster={<PalettePreview palette={p.palette} pages={p.pageCount} className="size-full" />} />
                </Card>
              ) : (
              <Card padded={false} className="overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-[13px] text-muted">
                  <span className="flex gap-1.5"><span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" /></span>
                  <span className="ml-2">Design palette</span>
                  <span className="ml-auto flex items-center gap-1.5">Live preview <SoonBadge /></span>
                </div>
                <PalettePreview palette={p.palette} pages={p.pageCount} className="aspect-[16/9]" />
              </Card>
              )}

              {(p.summary || p.audience) && (
                <section>
                  <h2 className="text-sm font-semibold">About this project</h2>
                  {p.summary && <p className="mt-2 text-sm text-muted">{p.summary}</p>}
                  {p.audience && <p className="mt-2 text-sm text-muted"><span className="text-fg">Built for:</span> {p.audience}</p>}
                </section>
              )}

              {p.pages.length > 0 && (
                <section>
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><Layers className="size-4 text-subtle" />Pages ({p.pages.length})</h2>
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {p.pages.map((pg) => <li key={pg.route} className="rounded-[var(--radius-md)] border border-border bg-surface p-3"><div className="flex items-baseline gap-2"><span className="font-medium">{pg.title}</span><span className="font-mono text-xs text-subtle">{pg.route}</span></div><p className="mt-1 line-clamp-2 text-[13px] text-muted">{pg.purpose}</p></li>)}
                  </ul>
                </section>
              )}

              <Comments slug={slug} signInHref={`/login?next=${encodeURIComponent(`/p/${slug}`)}`} />

              {p.remixList.length > 0 && (
                <section>
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><GitFork className="size-4 text-subtle" />Remixes</h2>
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">{p.remixList.map((r) => <ShowcaseCard key={r.slug} item={r} />)}</div>
                </section>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
              <Card className="space-y-4">
                <div className="grid grid-cols-3 text-center">
                  <div><div className="text-lg font-semibold tabular-nums">{p.likes}</div><div className="text-xs text-muted">Likes</div></div>
                  <div><div className="text-lg font-semibold tabular-nums">{p.views}</div><div className="text-xs text-muted">Views</div></div>
                  <div><div className="text-lg font-semibold tabular-nums">{p.remixes}</div><div className="text-xs text-muted">Remixes</div></div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {p.isOwner ? (
                    <Link href={`/projects/${p.projectId}`}><Button className="w-full">Open in workspace</Button></Link>
                  ) : p.allowRemix ? (
                    <Button className="w-full" loading={remix.isPending} onClick={async () => {
                      if (!session) return needLogin();
                      const r = await confirm({ title: `Remix “${p.title}”?`, body: 'You get your own copy of the published version in your workspace, credited to the original creator. The original isn’t changed. It counts toward your plan’s active projects.', confirmLabel: 'Remix with AI' });
                      if (r.ok) remix.mutate();
                    }}><Sparkles className="size-4" />Remix with AI</Button>
                  ) : <p className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-center text-[13px] text-muted">The creator hasn’t enabled remixing.</p>}
                  <Button variant="secondary" className="w-full" disabled={p.isOwner} onClick={() => (session ? like.mutate(!p.likedByMe) : needLogin())}>
                    <Heart className={p.likedByMe ? 'size-4 fill-accent text-accent' : 'size-4'} />{p.likedByMe ? 'Liked' : 'Like'}
                  </Button>
                  {session && <SaveToCollection slug={slug} />}
                  <Link href={session ? `/create?idea=${encodeURIComponent(`Something like “${p.title}”: ${p.description}`.slice(0, 600))}` : '/login'}><Button variant="ghost" className="w-full">Build something like this<ArrowRight className="size-4" /></Button></Link>
                </div>
                <dl className="space-y-1.5 border-t border-border pt-4 text-[13px]">
                  <div className="flex justify-between"><dt className="text-muted">Published</dt><dd>{p.publishedAt ? new Date(p.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Version</dt><dd>{p.versionNumber ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="flex items-center gap-1.5 text-muted"><FileCode2 className="size-3.5" />Files</dt><dd className="tabular-nums">{p.fileCount}</dd></div>
                  <div className="flex justify-between"><dt className="flex items-center gap-1.5 text-muted"><Eye className="size-3.5" />Source</dt><dd className="text-muted">{p.allowRemix ? 'Available by remixing' : 'Private'}</dd></div>
                </dl>
              </Card>
              <Card className="space-y-3">
                <h2 className="text-sm font-semibold">Share</h2>
                <ShareButtons url={url} title={p.title} />
              </Card>
              <div className="flex items-center justify-between gap-3">
                {p.showAttribution ? <MadeWith /> : <span />}
                {!p.isOwner && (
                  <button className="flex items-center gap-1.5 text-xs text-subtle hover:text-fg" onClick={async () => {
                    if (!session) return needLogin();
                    const r = await confirm({ title: 'Report this project', body: `Tell us what’s wrong (${REPORT_REASONS}). Reports are confidential.`, confirmLabel: 'Send report', danger: true, input: { label: 'What’s wrong?', placeholder: 'e.g. spam: copies another site', required: true } });
                    if (!r.ok) return;
                    const text = r.value.trim().toLowerCase();
                    const reason = ['spam', 'abuse', 'copyright', 'illegal', 'impersonation'].find((k) => text.includes(k)) ?? 'other';
                    report.mutate({ reason, details: r.value.trim() });
                  }}><Flag className="size-3.5" />Report</button>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
