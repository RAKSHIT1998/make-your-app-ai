'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Check, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Dialog, Field, Input, toast } from '@/components/ui';
import { community } from '@/lib/api';

/** Adds a public project to one of the signed-in person's collections. */
export function SaveToCollection({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['collections', slug], queryFn: () => community.collections(slug), enabled: open });
  const refresh = () => qc.invalidateQueries({ queryKey: ['collections'] });
  const toggle = useMutation({ mutationFn: (v: { id: string; on: boolean }) => community.setItem(v.id, slug, v.on), onSuccess: () => void refresh(), onError: (e) => toast.error((e as Error).message) });
  const create = useMutation({
    mutationFn: async () => { const c = await community.createCollection(name.trim()); await community.setItem(c.id, slug, true); },
    onSuccess: () => { setName(''); toast.success('Saved to a new collection'); void refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}><Bookmark className="size-4" />Save</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Save to a collection" description="Collections are your own lists of projects. Keep them private or share them.">
        <div className="space-y-4">
          {list.isPending ? <p className="text-sm text-muted">Loading…</p> : list.error ? <p className="text-sm text-danger">{(list.error as Error).message}</p> : list.data.length === 0 ? <p className="text-sm text-muted">You don’t have any collections yet.</p> : (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {list.data.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-muted" aria-pressed={!!c.has} onClick={() => toggle.mutate({ id: c.id, on: !c.has })}>
                    <span className="flex size-5 items-center justify-center rounded border border-border">{c.has && <Check className="size-3.5" />}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span><span className="text-xs text-subtle">{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <Field label="New collection" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Inspiration" /></Field>
            <Button type="submit" variant="secondary" loading={create.isPending} disabled={!name.trim()}><Plus className="size-4" />Create</Button>
          </form>
          <Link href="/collections" className="block text-[13px] font-medium underline-offset-4 hover:underline">Manage collections</Link>
        </div>
      </Dialog>
    </>
  );
}
