'use client';

import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import Link from 'next/link';
import { ProjectCard } from '@/components/project-card';
import { Button, Card, EmptyState, ErrorNotice, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

export default function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Link href="/create"><Button><Plus className="size-4" />New</Button></Link>
      </div>
      {projects.error ? <ErrorNotice error={projects.error} /> : !projects.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : projects.data.items.length === 0 ? (
        <Card><EmptyState icon={<FolderKanban className="size-5" />} title="No projects yet" body="Your generated websites and apps will appear here." action={<Link href="/create"><Button>Create a project</Button></Link>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{projects.data.items.map((p) => <ProjectCard key={p.id} project={p} />)}</div>
      )}
    </div>
  );
}
