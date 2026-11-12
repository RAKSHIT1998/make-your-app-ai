'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Server } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HostingNotConfigured, HostingUpgrade } from '@/components/hosting-notice';
import { timeAgo } from '@/components/project-card';
import { projectTypeOption } from '@/components/project-types';
import { Button, Card, EmptyState, ErrorNotice, PageHeader, Skeleton, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/ui/table';
import { hostingApi } from '@/lib/api';

export default function HostingPage() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['hosting-sites'], queryFn: hostingApi.sites, refetchInterval: (x) => (x.state.data?.sites.some((s) => s.lastDeployment && ['queued', 'building'].includes(s.lastDeployment.status)) ? 4000 : false) });
  return (
    <div className="space-y-6">
      <PageHeader title="Hosting" description="Deploy your websites, connect custom domains and manage environment variables." />
      {q.error ? <ErrorNotice error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-64" /> : (
        <>
          {!q.data.configured && <HostingNotConfigured />}
          {q.data.configured && !q.data.entitlements.canDeploy && <HostingUpgrade what="Deploying websites is included from the Creator plan. Custom domains are included from Pro." />}
          <DataTable
            rows={q.data.sites}
            rowKey={(s) => s.projectId}
            empty={<Card padded={false}><EmptyState icon={<Server className="size-5" />} title="No projects to host yet" body="Create a website first, then deploy it here." action={<Link href="/create"><Button>Create a website</Button></Link>} /></Card>}
            columns={[
              { key: 'n', header: 'Project', cell: (s) => <div><Link href={`/hosting/${s.projectId}`} className="font-medium hover:underline">{s.name}</Link><div className="text-xs text-subtle">{projectTypeOption(s.type)?.label}</div></div> },
              { key: 'u', header: 'Live URL', cell: (s) => s.productionUrl ? <a href={s.productionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate text-muted hover:text-fg">{s.productionUrl.replace('https://', '')}<ExternalLink className="size-3 shrink-0" /></a> : <span className="text-subtle">Not deployed</span> },
              { key: 's', header: 'Last deployment', cell: (s) => s.lastDeployment ? <div className="flex items-center gap-2"><StatusBadge status={s.lastDeployment.status} /><span className="text-xs text-subtle">v{s.lastDeployment.versionNumber} · {timeAgo(s.lastDeployment.createdAt)}</span></div> : <span className="text-subtle">—</span> },
              { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (s) => <Link href={`/hosting/${s.projectId}`}><Button size="sm" variant="secondary">Manage</Button></Link> },
            ]}
            mobile={{ primary: (s) => s.name, secondary: (s) => s.productionUrl?.replace('https://', '') ?? 'Not deployed', trailing: (s) => s.lastDeployment ? <StatusBadge status={s.lastDeployment.status} /> : <Link href={`/hosting/${s.projectId}`}><Button size="xs" variant="secondary">Manage</Button></Link> }}
            onRowClick={(s) => router.push(`/hosting/${s.projectId}`)}
          />
        </>
      )}
    </div>
  );
}
