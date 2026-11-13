'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, MessageSquare, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, ErrorNotice, Menu, MenuItem, MenuLabel, Skeleton, Textarea, toast, useConfirm } from '@/components/ui';
import { ApiError, community, type Comment } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const REASONS: [string, string][] = [['spam', 'Spam'], ['abuse', 'Abusive or hateful'], ['harassment', 'Harassment'], ['illegal', 'Illegal content'], ['other', 'Something else']];
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Conversation on a public project page. Reading is open; posting needs an account. */
export function Comments({ slug, signInHref }: { slug: string; signInHref: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['comments', slug, !!session];
  const q = useQuery({ queryKey: key, queryFn: () => community.comments(slug), retry: (n, e) => !(e instanceof ApiError && [404, 503].includes(e.status)) && n < 2 });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['comments', slug] });
  const remove = useMutation({ mutationFn: (id: string) => community.removeComment(id), onSuccess: () => { toast.success('Comment removed'); void refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const report = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => community.reportComment(id, reason), onSuccess: (r) => toast.success(r.duplicate ? 'You’ve already reported this comment' : 'Thanks — a moderator will review it'), onError: (e) => toast.error((e as Error).message) });

  // A switched-off feature should disappear rather than show an error on a public page.
  if (q.error instanceof ApiError && q.error.status === 503) return null;
  const items = q.data?.items ?? [];
  const top = items.filter((c) => !c.parentId);
  const repliesOf = (id: string) => items.filter((c) => c.parentId === id);

  const row = (c: Comment, nested: boolean) => (
    <li key={c.id} className={nested ? 'ml-8 border-l border-border pl-4' : ''}>
      <div className="flex items-baseline gap-2 text-[13px]">
        {c.author.handle ? <Link href={`/c/${c.author.handle}`} className="font-medium hover:underline">{c.author.name}</Link> : <span className="font-medium">{c.author.name}</span>}
        {c.byCreator && <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-subtle">Creator</span>}
        <span className="text-xs text-subtle">{ago(c.createdAt)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
      <div className="mt-1 flex gap-3 text-xs text-subtle">
        {!nested && q.data?.enabled && <button type="button" className="hover:text-fg" onClick={() => (session ? setReplyTo(replyTo === c.id ? null : c.id) : undefined)} disabled={!session} title={session ? undefined : 'Sign in to reply'}>Reply</button>}
        {c.canRemove && <button type="button" aria-label="Delete comment" className="inline-flex items-center gap-1 hover:text-danger" onClick={async () => { const r = await confirm({ title: 'Delete this comment?', body: 'This can’t be undone.', confirmLabel: 'Delete', danger: true }); if (r.ok) remove.mutate(c.id); }}><Trash2 className="size-3" />Delete</button>}
        {session && !c.mine && (
          <Menu align="start" trigger={<button type="button" aria-label="Report comment" className="inline-flex items-center gap-1 hover:text-fg"><Flag className="size-3" />Report</button>}>
            <MenuLabel>Why are you reporting this?</MenuLabel>
            {REASONS.map(([v, label]) => <MenuItem key={v} onSelect={() => report.mutate({ id: c.id, reason: v })}>{label}</MenuItem>)}
          </Menu>
        )}
      </div>
      {replyTo === c.id && <div className="mt-2"><Composer slug={slug} parentId={c.id} onDone={() => { setReplyTo(null); void refresh(); }} compact /></div>}
      {!nested && repliesOf(c.id).length > 0 && <ul className="mt-3 space-y-3">{repliesOf(c.id).map((r) => row(r, true))}</ul>}
    </li>
  );

  return (
    <section aria-labelledby="comments-h">
      <h2 id="comments-h" className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-4 text-subtle" />Comments{q.data ? ` (${items.length})` : ''}</h2>
      <div className="mt-3 space-y-4">
        {q.error ? <ErrorNotice error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-20" /> : (
          <>
            {!q.data.enabled ? <Card><p className="text-sm text-muted">The creator has turned off comments on this project.</p></Card>
              : session ? <Composer slug={slug} onDone={() => void refresh()} />
              : <Card><p className="text-sm text-muted"><Link href={signInHref} className="font-medium text-fg underline-offset-4 hover:underline">Sign in</Link> to join the conversation.</p></Card>}
            {top.length === 0 ? <p className="text-sm text-muted">{q.data.enabled ? 'No comments yet. Be the first to say something useful.' : 'No comments.'}</p> : <ul className="space-y-5">{top.map((c) => row(c, false))}</ul>}
          </>
        )}
      </div>
    </section>
  );
}

function Composer({ slug, parentId, onDone, compact }: { slug: string; parentId?: string; onDone: () => void; compact?: boolean }) {
  const [body, setBody] = useState('');
  const post = useMutation({
    mutationFn: () => community.addComment(slug, body.trim(), parentId),
    onSuccess: () => { setBody(''); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) post.mutate(); }}>
      <Textarea aria-label={parentId ? 'Write a reply' : 'Write a comment'} rows={compact ? 2 : 3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={parentId ? 'Write a reply…' : 'Share feedback or a question…'} />
      <div className="flex items-center gap-3"><Button type="submit" size="sm" loading={post.isPending} disabled={!body.trim()}>{parentId ? 'Reply' : 'Comment'}</Button><span className="text-xs text-subtle">{body.length}/1000 · be kind, links are limited</span></div>
    </form>
  );
}
