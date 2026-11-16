'use client';

import { PROJECT_TYPE_LABELS, type ProjectType } from '@mya/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PhaseBadge, nextDeadline } from '@/components/growth/challenge-bits';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, Select, Skeleton, Textarea, toast } from '@/components/ui';
import { challengesAdmin, type AdminChallenge, type ChallengeInput } from '@/lib/api';

const TYPES = Object.keys(PROJECT_TYPE_LABELS) as ProjectType[];
/** datetime-local value (viewer's local time) ↔ ISO. */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(10, 0, 0, 0); return d; };

function ChallengeForm({ initial, onDone }: { initial?: AdminChallenge; onDone: () => void }) {
  const qc = useQueryClient();
  const start = initial ? new Date(initial.startsAt) : nextMonday();
  const [f, setF] = useState({
    slug: initial?.slug ?? '', title: initial?.title ?? '', brief: initial?.brief ?? '', prize: initial?.prize ?? '',
    types: new Set<ProjectType>(initial?.projectTypes ?? []),
    startsAt: local(start), submissionsCloseAt: local(initial ? new Date(initial.submissionsCloseAt) : new Date(start.getTime() + 5 * 86_400_000)),
    votingClosesAt: local(initial ? new Date(initial.votingClosesAt) : new Date(start.getTime() + 7 * 86_400_000)),
    votesPerUser: String(initial?.votesPerUser ?? 3), status: initial?.status ?? 'draft' as ChallengeInput['status'],
  });
  const body = (): ChallengeInput => ({
    slug: f.slug.trim().toLowerCase(), title: f.title.trim(), brief: f.brief.trim(), prize: f.prize.trim() || null, projectTypes: [...f.types],
    startsAt: new Date(f.startsAt).toISOString(), submissionsCloseAt: new Date(f.submissionsCloseAt).toISOString(), votingClosesAt: new Date(f.votingClosesAt).toISOString(),
    votesPerUser: Number(f.votesPerUser), status: f.status,
  });
  const save = useMutation({
    mutationFn: () => { const { slug, ...rest } = body(); return initial ? challengesAdmin.update(initial.id, rest) : challengesAdmin.create({ slug, ...rest }); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-challenges'] }); toast.success(initial ? 'Challenge saved' : 'Challenge created'); onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form id="challenge-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><Input id="ch-title" value={f.title} onChange={set('title')} maxLength={80} required placeholder="Arcade week" /></Field>
        <Field label="Address" hint={initial ? 'Fixed once created' : `/challenges/${f.slug || 'arcade-week'}`}><Input id="ch-slug" value={f.slug} onChange={set('slug')} disabled={!!initial} required pattern="[a-z0-9][a-z0-9\-]{1,58}[a-z0-9]" placeholder="arcade-week" /></Field>
      </div>
      <Field label="Brief" hint="What to build, and what makes a great entry."><Textarea id="ch-brief" rows={4} value={f.brief} onChange={set('brief')} minLength={20} maxLength={2000} required /></Field>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium">Who can enter <span className="font-normal text-muted">(none ticked = any type)</span></legend>
        <div className="flex flex-wrap gap-2">{TYPES.map((t) => (
          <label key={t} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[13px] has-[:checked]:border-fg">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={f.types.has(t)} onChange={(e) => { const s = new Set(f.types); if (e.target.checked) s.add(t); else s.delete(t); setF({ ...f, types: s }); }} />{PROJECT_TYPE_LABELS[t]}
          </label>))}</div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Starts"><Input id="ch-start" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} required /></Field>
        <Field label="Entries close"><Input id="ch-close" type="datetime-local" value={f.submissionsCloseAt} onChange={set('submissionsCloseAt')} required /></Field>
        <Field label="Voting closes"><Input id="ch-vote" type="datetime-local" value={f.votingClosesAt} onChange={set('votingClosesAt')} required /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_160px]">
        <Field label="Prize (optional)" hint="Shown exactly as written. Only promise what you will give."><Input id="ch-prize" value={f.prize} onChange={set('prize')} maxLength={200} placeholder="3 months of Creator" /></Field>
        <Field label="Votes each"><Input id="ch-votes" inputMode="numeric" value={f.votesPerUser} onChange={set('votesPerUser')} pattern="([1-9]|10)" required /></Field>
        <Field label="Status"><Select id="ch-status" value={f.status} onChange={set('status')}><option value="draft">Draft (hidden)</option><option value="published">Published</option><option value="cancelled">Cancelled</option></Select></Field>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button><Button type="submit" loading={save.isPending}>{initial ? 'Save' : 'Create challenge'}</Button></div>
    </form>
  );
}

function Entries({ c }: { c: AdminChallenge }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-challenge-entries', c.id], queryFn: () => challengesAdmin.entries(c.id) });
  const mod = useMutation({
    mutationFn: ({ id, hide }: { id: string; hide: boolean }) => (hide ? challengesAdmin.hide(id, 'Removed by moderator') : challengesAdmin.restore(id)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-challenge-entries', c.id] }); toast.success('Updated'); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-24" />;
  if (!q.data.length) return <p className="text-sm text-muted">No entries yet.</p>;
  return (
    <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
      {q.data.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <span className="w-10 font-semibold tabular-nums">{e.votes}</span>
          <span className="min-w-0 flex-1 truncate">{e.project ? <Link className="hover:underline" href={`/p/${e.project.slug}`}>{e.project.title}</Link> : 'Unpublished project'}{e.project && <span className="text-muted"> · @{e.project.creator.handle}</span>}</span>
          {e.hidden && <Badge tone="warning">Hidden</Badge>}
          <Button size="sm" variant="ghost" loading={mod.isPending && mod.variables?.id === e.id} onClick={() => mod.mutate({ id: e.id, hide: !e.hidden })}>{e.hidden ? 'Restore' : 'Hide'}</Button>
        </li>
      ))}
    </ul>
  );
}

export function AdminChallengesPanel() {
  const q = useQuery({ queryKey: ['admin-challenges'], queryFn: challengesAdmin.list });
  const [editing, setEditing] = useState<AdminChallenge | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">Weekly challenges: write the brief and the dates; creators enter published projects and the community votes. The top three of an ended challenge are its winners. Prizes are yours to give.</p>
        <Button onClick={() => setEditing('new')}><Plus className="size-4" />New challenge</Button>
      </div>
      {q.error ? <ErrorNotice error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-40" /> : q.data.length === 0 ? (
        <Card><EmptyState icon={<Trophy className="size-5" />} title="No challenges yet" body="Create the first one: a short brief, a week of entries and a couple of days of voting works well." action={<Button size="sm" onClick={() => setEditing('new')}>New challenge</Button>} /></Card>
      ) : (
        <div className="space-y-3">
          {q.data.map((c) => (
            <Card key={c.id} className="space-y-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.title}</span><PhaseBadge phase={c.phase} /></div>
                  <p className="mt-0.5 text-[13px] text-muted">{nextDeadline(c) || `Status: ${c.status}`} · {c.entries} {c.entries === 1 ? 'entry' : 'entries'}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.status === 'published' && <Link href={`/challenges/${c.slug}`}><Button size="sm" variant="ghost"><ExternalLink className="size-4" />View</Button></Link>}
                  <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide entries' : 'Entries'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
                </div>
              </div>
              {open === c.id && <Entries c={c} />}
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'New challenge' : 'Edit challenge'} size="lg">
        {editing !== null && <ChallengeForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}
