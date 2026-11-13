'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Copy, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Input, LinkButton, PageHeader, Skeleton, Toggle, toast, useConfirm } from '@/components/ui';
import { community } from '@/lib/api';

export default function CollectionsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const list = useQuery({ queryKey: ['collections'], queryFn: () => community.collections() });
  const refresh = () => qc.invalidateQueries({ queryKey: ['collections'] });
  const create = useMutation({ mutationFn: () => community.createCollection(name.trim()), onSuccess: () => { setName(''); void refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const patch = useMutation({ mutationFn: (v: { id: string; isPublic: boolean }) => community.updateCollection(v.id, { isPublic: v.isPublic }), onSuccess: () => void refresh(), onError: (e) => toast.error((e as Error).message) });
  const del = useMutation({ mutationFn: (id: string) => community.deleteCollection(id), onSuccess: () => { toast.success('Collection deleted'); void refresh(); }, onError: (e) => toast.error((e as Error).message) });
  async function copyLink(id: string) {
    try { await navigator.clipboard.writeText(`${window.location.origin}/collections/${id}`); toast.success('Link copied'); } catch { toast.error('Couldn’t copy the link'); }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Collections" description="Save public projects you like into lists. Keep a list private, or share it with a link." />
      <Card>
        <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <Field label="New collection" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Restaurant sites I like" /></Field>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>Create</Button>
        </form>
      </Card>
      {list.error ? <ErrorNotice error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <Skeleton className="h-32" /> : list.data.length === 0 ? (
        <Card padded={false}><EmptyState icon={<Bookmark className="size-5" />} title="No collections yet" body="Open any public project and use Save to start one." action={<LinkButton href="/explore" variant="secondary">Explore projects</LinkButton>} /></Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-border">
            {list.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48"><Link href={`/collections/${c.id}`} className="block truncate text-sm font-medium hover:underline">{c.name}</Link><div className="text-xs text-subtle">{c.count} {c.count === 1 ? 'project' : 'projects'}</div></div>
                {c.isPublic && <Badge tone="info">Public</Badge>}
                <Toggle checked={c.isPublic} onChange={(v) => patch.mutate({ id: c.id, isPublic: v })} label="Public" />
                {c.isPublic && <Button variant="ghost" size="sm" iconOnly aria-label={`Copy link to ${c.name}`} onClick={() => copyLink(c.id)}><Copy className="size-4" /></Button>}
                <Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${c.name}`} onClick={async () => { const r = await confirm({ title: `Delete “${c.name}”?`, body: 'The projects themselves aren’t affected.', confirmLabel: 'Delete', danger: true }); if (r.ok) del.mutate(c.id); }}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
