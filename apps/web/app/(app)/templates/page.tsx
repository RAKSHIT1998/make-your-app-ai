'use client';

import type { ProjectType } from '@mya/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LayoutTemplate, Layers, Search, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { PalettePreview } from '@/components/growth/showcase-card';
import { projectTypeOption } from '@/components/project-types';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, PageHeader, Segmented, Select, Skeleton, toast } from '@/components/ui';
import { CATEGORIES, CATEGORY_LABELS, templatesApi, type Category, type TemplateCard } from '@/lib/api';

export default function TemplatesPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [sort, setSort] = useState<'popular' | 'new' | 'featured'>('popular');
  const [open, setOpen] = useState<TemplateCard | null>(null);
  const [name, setName] = useState('');
  const dq = useDeferredValue(q.trim());
  const list = useQuery({ queryKey: ['templates', dq, category, sort], queryFn: () => templatesApi.list({ q: dq || undefined, category: category || undefined, sort }), placeholderData: (p) => p });
  const use = useMutation({
    mutationFn: () => templatesApi.use(open!.slug, name.trim() || undefined),
    onSuccess: (p) => { toast.success('Project created from the template'); router.push(`/projects/${p.id}`); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Templates" description="Start from a proven project made by the community, then make it yours with AI. Every template is reviewed before it’s listed." />
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative lg:w-80"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /><Input aria-label="Search templates" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category | '')} className="lg:w-48"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</Select>
        <div className="lg:ml-auto"><Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'popular', label: 'Popular' }, { value: 'new', label: 'New' }, { value: 'featured', label: 'Featured' }]} /></div>
      </div>
      {list.error ? <ErrorNotice error={list.error} onRetry={() => list.refetch()} /> : !list.data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-[var(--radius-lg)]" />)}</div>
      ) : list.data.length === 0 ? (
        <Card padded={false}><EmptyState icon={<LayoutTemplate className="size-5" />} title={dq || category || sort === 'featured' ? 'No templates match' : 'No templates yet'} body={dq || category ? 'Try a different search.' : 'Creators can offer a published project as a template from its Share menu. Approved templates appear here.'} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((t) => (
            <button key={t.slug} onClick={() => { setOpen(t); setName(''); }} className="group rounded-[var(--radius-lg)] border border-border bg-surface text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">
              <PalettePreview palette={t.palette} pages={t.pageCount} className="aspect-[16/10] rounded-t-[var(--radius-lg)] border-b border-border" />
              <div className="p-4">
                <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{t.title}</h3>{t.featured && <Badge tone="accent">Featured</Badge>}<Badge tone="success">Free</Badge></div>
                <p className="mt-1 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{t.description || t.summary || 'No description.'}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-subtle">
                  <span className="truncate">{projectTypeOption(t.type)?.label}{t.category ? ` · ${CATEGORY_LABELS[t.category]}` : ''}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1"><Users className="size-3.5" />{t.uses}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-subtle">Paid templates and creator earnings are coming soon. Today every template is free.</p>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.title ?? ''} description={open ? `By @${open.creator.handle} · used ${open.uses} time${open.uses === 1 ? '' : 's'}` : undefined}
        footer={<><Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button><Button loading={use.isPending} onClick={() => use.mutate()}>Use this template</Button></>}>
        {open && (
          <div className="space-y-4 text-sm">
            <PalettePreview palette={open.palette} pages={open.pageCount} className="aspect-[16/8] rounded-[var(--radius-md)] border border-border" />
            {(open.description || open.summary) && <p className="text-muted">{open.description || open.summary}</p>}
            {open.pages.length > 0 && <div><div className="flex items-center gap-1.5 font-medium"><Layers className="size-3.5 text-subtle" />Pages</div><ul className="mt-1.5 space-y-1 text-[13px]">{open.pages.map((p) => <li key={p.route}><span className="font-medium">{p.title}</span> <span className="text-muted">— {p.purpose}</span></li>)}</ul></div>}
            <Field label="Project name" hint="Optional"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={open.title} maxLength={80} /></Field>
            <p className="text-xs text-subtle">You get your own copy ({open.fileCount} files) in your workspace. It counts toward your plan’s active projects; using a template costs no AI credits.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
