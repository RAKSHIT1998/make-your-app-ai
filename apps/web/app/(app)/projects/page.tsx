'use client';

import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ProjectCard } from '@/components/project-card';
import { PROJECT_TYPE_OPTIONS } from '@/components/project-types';
import { Button, Card, EmptyState, ErrorNotice, Input, PageHeader, Segmented, Select, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

export default function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const rows = useMemo(() => (projects.data?.items ?? []).filter((p) => (view === 'archived' ? p.status === 'archived' : p.status !== 'archived') && (!type || p.type === type) && p.name.toLowerCase().includes(q.toLowerCase())), [projects.data, q, type, view]);
  return (
    <div className="space-y-6">
      <PageHeader title="Projects" description="Everything you've built, in one place." actions={<Link href="/create"><Button><Plus className="size-4" />New project</Button></Link>} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /><Input aria-label="Search projects" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} className="sm:w-48"><option value="">All types</option>{PROJECT_TYPE_OPTIONS.map((o) => <option key={o.type} value={o.type}>{o.label}</option>)}</Select>
        <Segmented label="Show" value={view} onChange={setView} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
      </div>
      {projects.error ? <ErrorNotice error={projects.error} onRetry={() => projects.refetch()} /> : !projects.data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[104px] rounded-[var(--radius-lg)]" />)}</div>
      ) : rows.length === 0 ? (
        <Card padded={false}><EmptyState icon={<FolderKanban className="size-5" />} title={projects.data.items.length ? 'No matching projects' : 'No projects yet'} body={projects.data.items.length ? 'Try a different search or filter.' : 'Your generated websites and apps will appear here.'} action={!projects.data.items.length && <Link href="/create"><Button>Create a project</Button></Link>} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((p) => <ProjectCard key={p.id} project={p} />)}</div>
      )}
    </div>
  );
}
