'use client';

import type { ProjectType } from '@mya/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleDashed, FolderKanban } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProjectCard } from './project-card';
import { Card, EmptyState, ErrorNotice, PageHeader, SectionTitle, Skeleton, SoonBadge } from './ui';
import { api } from '@/lib/api';

export interface Capability { label: string; detail: string; live: boolean }

/** Shared layout for studios: intro, a create area, the studio's projects and an honest capability list. */
export function StudioPage({ title, description, types, create, capabilities, emptyBody }: { title: string; description: string; types: ProjectType[]; create: ReactNode; capabilities: Capability[]; emptyBody: string }) {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const rows = (projects.data?.items ?? []).filter((p) => types.includes(p.type as ProjectType) && p.status !== 'archived');
  return (
    <div className="space-y-8">
      <PageHeader title={title} description={description} />
      {create}
      <section className="space-y-3">
        <SectionTitle>Projects in this studio</SectionTitle>
        {projects.error ? <ErrorNotice error={projects.error} onRetry={() => projects.refetch()} /> : !projects.data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px] rounded-[var(--radius-lg)]" />)}</div>
        ) : rows.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map((p) => <ProjectCard key={p.id} project={p} />)}</div>
        ) : (
          <Card padded={false}><EmptyState compact icon={<FolderKanban className="size-5" />} title="Nothing here yet" body={emptyBody} /></Card>
        )}
      </section>
      <section className="space-y-3">
        <SectionTitle>What this studio can do today</SectionTitle>
        <Card padded={false}>
          <ul className="divide-y divide-border">
            {capabilities.map((c) => (
              <li key={c.label} className="flex items-start gap-3 px-4 py-3">
                {c.live ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-subtle" />}
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{c.label}</div><div className="text-[13px] text-muted">{c.detail}</div></div>
                {!c.live && <SoonBadge />}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
