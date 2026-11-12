'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { Composer } from '@/components/composer';
import { ProjectCard } from '@/components/project-card';
import { ProgressCard, Timeline } from '@/components/progress-card';
import { Card, EmptyState, ErrorNotice, Meter, SectionTitle, Skeleton } from '@/components/ui';
import { api, billing } from '@/lib/api';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const plan = useQuery({ queryKey: ['billing'], queryFn: billing.overview });
  const name = me.data?.displayName ?? me.data?.email.split('@')[0];
  const active = projects.data?.items.filter((p) => p.status !== 'archived') ?? [];

  return (
    <div className="space-y-12">
      <section className="mx-auto max-w-3xl space-y-6 pt-2 md:pt-8">
        <div className="text-center">
          <p className="text-sm text-muted">{greeting()}{name ? `, ${name}` : ''}</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">What do you want to build?</h1>
        </div>
        <Composer compact />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <SectionTitle action={<Link href="/projects" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">All projects<ArrowRight className="size-3.5" /></Link>}>Recent projects</SectionTitle>
          {projects.error ? <ErrorNotice error={projects.error} onRetry={() => projects.refetch()} /> : !projects.data ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-[var(--radius-lg)]" />)}</div>
          ) : active.length === 0 ? (
            <Card padded={false}><EmptyState icon={<FolderKanban className="size-5" />} title="No projects yet" body="Describe an idea above — you'll get a working, editable project you own." compact /></Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{active.slice(0, 6).map((p) => <ProjectCard key={p.id} project={p} />)}</div>
          )}
          <div className="mt-10">
            <SectionTitle>Activity</SectionTitle>
            <Timeline limit={10} />
          </div>
        </section>

        <aside className="space-y-8">
          <section>
            <SectionTitle action={<Link href="/billing" className="text-[13px] font-medium text-muted hover:text-fg">Manage</Link>}>Plan & credits</SectionTitle>
            <Card className="space-y-4">
              {!plan.data ? <Skeleton className="h-20" /> : (
                <>
                  <div className="flex items-baseline justify-between"><span className="text-sm font-semibold">{plan.data.plan.name}</span><span className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">{plan.data.credits.total.toLocaleString()}<span className="ml-1 text-xs font-normal text-subtle">credits</span></span></div>
                  <Meter label="Monthly allowance used" value={Math.max(0, plan.data.entitlements.monthlyCredits - plan.data.credits.allowanceRemaining)} max={plan.data.entitlements.monthlyCredits} />
                  <div className="flex justify-between text-[13px]"><span className="text-muted">{plan.data.subscription?.currentPeriodEnd ? (plan.data.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews') : 'Resets'}</span><span>{new Date(plan.data.subscription?.currentPeriodEnd ?? plan.data.period.end ?? Date.now()).toLocaleDateString()}</span></div>
                </>
              )}
            </Card>
          </section>
          <section>
            <SectionTitle>Your progress</SectionTitle>
            <ProgressCard />
          </section>
        </aside>
      </div>
    </div>
  );
}
