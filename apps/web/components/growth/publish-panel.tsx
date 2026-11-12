'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe, Lock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, ErrorNotice, Field, Input, Notice, Select, Skeleton, Textarea, toast } from '../ui';
import { ShareButtons } from './share';
import { CATEGORIES, CATEGORY_LABELS, showcase, templatesApi, type Category, type Publishing } from '@/lib/api';

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm"><span className="font-medium">{label}</span>{hint && <span className="block text-[13px] text-muted">{hint}</span>}</span>
    </label>
  );
}

/** Publish a project to its public page, choose what visitors may do, and share the link. */
export function PublishPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const pub = useQuery({ queryKey: ['publishing', projectId], queryFn: () => showcase.publishing(projectId) });
  const [f, setF] = useState<{ publicTitle: string; publicDescription: string; category: Category | ''; allowRemix: boolean; showAttribution: boolean } | null>(null);
  useEffect(() => {
    if (pub.data && !f) setF({ publicTitle: pub.data.publicTitle, publicDescription: pub.data.publicDescription, category: pub.data.category ?? '', allowRemix: pub.data.allowRemix, showAttribution: pub.data.showAttribution });
  }, [pub.data, f]);
  const save = useMutation({
    mutationFn: (visibility: Publishing['visibility']) => showcase.publish(projectId, { visibility, ...f!, category: f!.category || null }),
    onSuccess: (d, v) => {
      qc.setQueryData(['publishing', projectId], d);
      void qc.invalidateQueries({ queryKey: ['explore'] });
      toast.success(v === 'public' ? (pub.data?.visibility === 'public' ? 'Public page updated' : 'Published — your project has a public page') : 'Unpublished');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  if (pub.error) return <ErrorNotice error={pub.error} onRetry={() => pub.refetch()} />;
  if (!pub.data || !f) return <Skeleton className="h-64" />;
  const d = pub.data;
  const live = d.visibility === 'public';
  const url = d.slug ? `${window.location.origin}/p/${d.slug}` : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3 text-sm">
        {live ? <Globe className="size-4 text-success" /> : <Lock className="size-4 text-subtle" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{live ? 'Public' : 'Private'}</div>
          <div className="text-[13px] text-muted">{live ? 'Anyone with the link can view it, and it can appear in Explore.' : 'Only your workspace can see this project.'}</div>
        </div>
        {live && url && <Link href={`/p/${d.slug}`} target="_blank"><Button size="sm" variant="ghost" iconOnly aria-label="Open public page"><ExternalLink className="size-4" /></Button></Link>}
      </div>

      {d.moderated && <Notice tone="warning">A moderator unpublished this project{d.moderationNote ? `: ${d.moderationNote}` : '.'} It can’t be republished.</Notice>}
      {!d.hasVersion && <Notice>Generate your project first — there’s nothing to publish yet.</Notice>}
      {live && d.outdated && <Notice tone="info">You’ve made changes since publishing. Visitors and remixers still get the published version until you update it.</Notice>}

      <div className="space-y-4">
        <Field label="Title"><Input value={f.publicTitle} maxLength={80} onChange={(e) => setF({ ...f, publicTitle: e.target.value })} /></Field>
        <Field label="Description" hint="Shown on your public page and in Explore."><Textarea rows={3} maxLength={600} value={f.publicDescription} onChange={(e) => setF({ ...f, publicDescription: e.target.value })} /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category | '' })}><option value="">Choose a category</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</Select></Field>
        <Toggle checked={f.allowRemix} onChange={(v) => setF({ ...f, allowRemix: v })} label="Allow Remix with AI" hint="Others can copy the published version into their own workspace, credited to you. Secrets and your private edits are never shared." />
        <Toggle checked={f.showAttribution} onChange={(v) => setF({ ...f, showAttribution: v })} disabled={!d.canHideAttribution} label="Show “Made with Make Your App AI”" hint={d.canHideAttribution ? undefined : 'Paid plans can hide the badge.'} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!d.hasVersion || d.moderated || !f.publicTitle.trim()} loading={save.isPending && save.variables === 'public'} onClick={() => save.mutate('public')}>{live ? (d.outdated ? 'Update public version' : 'Save changes') : 'Publish'}</Button>
        {live && <Button variant="secondary" loading={save.isPending && save.variables === 'private'} onClick={() => save.mutate('private')}>Unpublish</Button>}
      </div>

      {live && <TemplateOffer projectId={projectId} />}

      {live && url && (
        <div className="space-y-3 border-t border-border pt-5">
          <h3 className="text-sm font-semibold">Share your project</h3>
          <ShareButtons url={url} title={f.publicTitle} />
          {d.creatorHandle && <p className="text-[13px] text-muted">Your creator profile: <Link className="font-medium text-fg hover:underline" href={`/c/${d.creatorHandle}`}>@{d.creatorHandle}</Link></p>}
        </div>
      )}
    </div>
  );
}

function TemplateOffer({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const t = useQuery({ queryKey: ['my-template', projectId], queryFn: () => templatesApi.mine(projectId) });
  const submit = useMutation({ mutationFn: () => templatesApi.submit(projectId, {}), onSuccess: (d) => { qc.setQueryData(['my-template', projectId], d); toast.success('Submitted for review'); }, onError: (e) => toast.error((e as Error).message) });
  const withdraw = useMutation({ mutationFn: () => templatesApi.withdraw(projectId), onSuccess: (d) => { qc.setQueryData(['my-template', projectId], d); toast.success('Template withdrawn'); }, onError: (e) => toast.error((e as Error).message) });
  if (t.isLoading) return null;
  const d = t.data;
  const label = { pending: 'Waiting for review', approved: 'Listed in Templates', rejected: 'Not approved', withdrawn: 'Withdrawn' } as const;
  return (
    <div className="space-y-2 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">Offer as a template</h3>
      <p className="text-[13px] text-muted">Let others start new projects from the published version. Templates are reviewed before they’re listed, and they’re free for everyone.</p>
      {d && d.status !== 'withdrawn' && <p className="text-[13px]"><span className="font-medium">{label[d.status]}</span>{d.status === 'approved' ? ` · used ${d.uses} time${d.uses === 1 ? '' : 's'}` : ''}{d.reviewNote ? <span className="text-muted"> — {d.reviewNote}</span> : null}</p>}
      <div className="flex gap-2">
        {(!d || d.status === 'withdrawn' || d.status === 'rejected' || d.status === 'approved') && <Button size="sm" variant="secondary" loading={submit.isPending} onClick={() => submit.mutate()}>{d && d.status !== 'withdrawn' ? 'Resubmit published version' : 'Submit as template'}</Button>}
        {d && (d.status === 'pending' || d.status === 'approved') && <Button size="sm" variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw</Button>}
      </div>
    </div>
  );
}
