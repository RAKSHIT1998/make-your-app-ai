'use client';

import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ProjectCard } from '@/components/project-card';
import { Button, Card, EmptyState, ErrorNotice, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

const IDEAS = [
  'A website for my boutique hotel with rooms, gallery and WhatsApp enquiries',
  'A portfolio site for a wedding photographer with packages and a contact form',
  'A landing page for a SaaS that schedules social media posts',
];

export default function HomePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const credits = useQuery({ queryKey: ['credits'], queryFn: api.credits });
  const name = me.data?.email.split('@')[0];

  return (
    <div className="space-y-10">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{name ? `Welcome, ${name}` : 'Welcome'}</h1>
          <p className="mt-1 text-muted">What would you like to build today?</p>
        </div>
        <Link href="/create"><Button size="lg"><Plus className="size-4" />New project</Button></Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="text-sm text-muted">Credits available</div>
          <div className="mt-1 text-3xl font-semibold">{credits.data ? credits.data.balance.toLocaleString() : <Skeleton className="h-9 w-24" />}</div>
          <p className="mt-2 text-sm text-subtle">Credits are used by AI generation. Billing plans arrive in a later release.</p>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-muted">Projects</div>
          <div className="mt-1 text-3xl font-semibold">{projects.data ? projects.data.items.length : <Skeleton className="h-9 w-16" />}</div>
          <p className="mt-2 text-sm text-subtle">Websites and business websites can be generated today.</p>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Recent projects</h2>
          <Link href="/projects" className="text-sm text-brand hover:underline">View all</Link>
        </div>
        {projects.error ? <ErrorNotice error={projects.error} /> : !projects.data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : projects.data.items.length === 0 ? (
          <Card><EmptyState icon={<FolderKanban className="size-5" />} title="No projects yet" body="Describe an idea and get a working, editable website you own." action={<Link href="/create"><Button>Create your first project</Button></Link>} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{projects.data.items.slice(0, 6).map((p) => <ProjectCard key={p.id} project={p} />)}</div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Ideas to start from</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {IDEAS.map((idea) => (
            <Link key={idea} href={`/create?idea=${encodeURIComponent(idea)}`}>
              <Card className="flex h-full gap-3 p-4 text-sm transition-colors hover:border-brand/50">
                <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
                {idea}
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
