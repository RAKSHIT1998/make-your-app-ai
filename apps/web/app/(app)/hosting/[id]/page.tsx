'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, Globe, KeyRound, Lock, RefreshCw, RotateCcw, Rocket, ScrollText, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { HostingNotConfigured, HostingUpgrade } from '@/components/hosting-notice';
import { timeAgo } from '@/components/project-card';
import { Badge, Button, Card, cx, Drawer, EmptyState, ErrorNotice, Field, Input, Notice, Skeleton, StatusBadge, Tabs, toast, useConfirm } from '@/components/ui';
import { DataTable } from '@/components/ui/table';
import { api, hostingApi, type Deployment, type HostedDomain } from '@/lib/api';

type Tab = 'deployments' | 'domains' | 'env';

export default function ProjectHostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('deployments');
  const [logsFor, setLogsFor] = useState<Deployment | null>(null);
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
  const h = useQuery({ queryKey: ['hosting', id], queryFn: () => hostingApi.status(id), refetchInterval: (q) => (q.state.data?.deployments.some((d) => ['queued', 'building'].includes(d.status)) ? 3000 : false) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['hosting', id] }); void qc.invalidateQueries({ queryKey: ['hosting-sites'] }); };
  const deploy = useMutation({ mutationFn: () => hostingApi.deploy(id), onSuccess: () => { toast.success('Deployment started'); refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const rollback = useMutation({ mutationFn: (d: Deployment) => hostingApi.rollback(id, d.id), onSuccess: (_, d) => { toast.success(`Rolling back to version ${d.versionNumber}`); refresh(); }, onError: (e) => toast.error((e as Error).message) });

  if (h.error) return <ErrorNotice error={h.error} onRetry={() => h.refetch()} />;
  const s = h.data;
  const busy = s?.deployments.some((d) => ['queued', 'building'].includes(d.status));
  const live = s?.deployments.find((d) => d.current);
  const behind = s && live && s.headVersion !== null && live.versionNumber !== s.headVersion;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/hosting" className="flex size-9 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-muted hover:text-fg" aria-label="Back to Hosting"><ArrowLeft className="size-4" /></Link>
        <div className="min-w-0 flex-1">
          {project.data ? <h1 className="truncate text-xl font-semibold tracking-[-0.02em]">{project.data.name}</h1> : <Skeleton className="h-7 w-48" />}
          {s?.site?.productionUrl ? <a href={s.site.productionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-[13px] text-muted hover:text-fg">{s.site.productionUrl.replace('https://', '')}<ExternalLink className="size-3 shrink-0" /></a> : <div className="text-[13px] text-subtle">Not deployed yet</div>}
        </div>
        <Link href={`/projects/${id}`}><Button variant="secondary" size="sm">Open workspace</Button></Link>
        {s && (
          <Button size="sm" disabled={!s.configured || !s.entitlements.canDeploy || s.headVersion === null || busy} loading={deploy.isPending} onClick={async () => {
            const r = await confirm({ title: `Deploy version ${s.headVersion}?`, body: `This publishes the current code to ${s.site?.productionUrl ? s.site.productionUrl.replace('https://', '') : 'a new live URL'}. Visitors will see it once the build finishes. You can roll back afterwards.`, confirmLabel: 'Deploy' });
            if (r.ok) deploy.mutate();
          }}><Rocket className="size-3.5" />{busy ? 'Deploying…' : 'Deploy'}</Button>
        )}
      </div>

      {!s ? <Skeleton className="h-64" /> : (
        <>
          {!s.configured && <HostingNotConfigured />}
          {s.configured && !s.entitlements.canDeploy && <HostingUpgrade what="Deploying websites is included from the Creator plan." />}
          {s.headVersion === null && <Notice>Generate this project first — there’s nothing to deploy yet.</Notice>}
          {behind && !busy && <Notice tone="info">Your live site is version {live!.versionNumber}; the latest is version {s.headVersion}. Deploy to publish your recent changes.</Notice>}

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} items={[
            { value: 'deployments', label: <><Rocket className="size-3.5" />Deployments</> },
            { value: 'domains', label: <><Globe className="size-3.5" />Domains</> },
            { value: 'env', label: <><KeyRound className="size-3.5" />Environment</> },
          ]} />

          {tab === 'deployments' && (
            <DataTable
              rows={s.deployments}
              rowKey={(d) => d.id}
              empty={<Card padded={false}><EmptyState compact icon={<Rocket className="size-5" />} title="No deployments yet" body="Deploy to get a live URL for this website." /></Card>}
              columns={[
                { key: 's', header: 'Status', cell: (d) => <div className="flex items-center gap-2"><StatusBadge status={d.status} />{d.current && <Badge tone="success">Current</Badge>}{d.kind === 'rollback' && <Badge>Rollback</Badge>}</div> },
                { key: 'v', header: 'Version', cell: (d) => <span className="tabular-nums">v{d.versionNumber}</span> },
                { key: 'u', header: 'URL', cell: (d) => d.url && ['live', 'deployed_unverified'].includes(d.status) ? <a className="inline-flex max-w-[240px] items-center gap-1 truncate text-muted hover:text-fg" href={d.url} target="_blank" rel="noopener noreferrer">{d.url.replace('https://', '')}<ExternalLink className="size-3 shrink-0" /></a> : d.error ? <span className="block max-w-[260px] truncate text-danger" title={d.error}>{d.error}</span> : <span className="text-subtle">—</span> },
                { key: 't', header: 'When', cell: (d) => <span className="text-muted">{timeAgo(d.createdAt)}</span> },
                { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (d) => <DeploymentActions d={d} /> },
              ]}
              mobile={{ primary: (d) => <span className="flex items-center gap-2">v{d.versionNumber} {d.current && <Badge tone="success">Current</Badge>}</span>, secondary: (d) => d.error ?? timeAgo(d.createdAt), trailing: (d) => <div className="flex items-center gap-1"><StatusBadge status={d.status} /><DeploymentActions d={d} /></div> }}
            />
          )}
          {tab === 'domains' && <Domains projectId={id} domains={s.domains} canUse={s.entitlements.canUseCustomDomains} deployed={!!s.site} configured={s.configured} onChange={refresh} />}
          {tab === 'env' && <EnvVars projectId={id} vars={s.env} onChange={refresh} />}
        </>
      )}

      <Drawer open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)} title={logsFor ? `Build logs · v${logsFor.versionNumber}` : 'Build logs'}>
        {logsFor && <Logs projectId={id} deployment={logsFor} />}
      </Drawer>
    </div>
  );

  function DeploymentActions({ d }: { d: Deployment }) {
    return (
      <div className="flex justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={() => setLogsFor(d)}><ScrollText className="size-3.5" />Logs</Button>
        {!d.current && ['live', 'deployed_unverified'].includes(d.status) && (
          <Button size="xs" variant="secondary" disabled={busy} onClick={async () => {
            const r = await confirm({ title: `Roll back to version ${d.versionNumber}?`, body: 'This redeploys that version’s exact files as a new deployment. Your code and version history in the workspace don’t change.', confirmLabel: 'Roll back' });
            if (r.ok) rollback.mutate(d);
          }}><RotateCcw className="size-3.5" />Roll back</Button>
        )}
      </div>
    );
  }
}

function Logs({ projectId, deployment }: { projectId: string; deployment: Deployment }) {
  const q = useQuery({ queryKey: ['deploy-logs', deployment.id], queryFn: () => hostingApi.logs(projectId, deployment.id), refetchInterval: ['queued', 'building'].includes(deployment.status) ? 3000 : false });
  if (q.error) return <ErrorNotice error={q.error} />;
  if (!q.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-3">
      {deployment.error && <Notice tone="danger">{deployment.error}</Notice>}
      {deployment.health && !deployment.health.ok && <Notice tone="warning">The build finished, but the URL didn’t respond to our check{deployment.health.status ? ` (HTTP ${deployment.health.status})` : ''}. It may still be starting.</Notice>}
      <pre className="max-h-[60vh] overflow-auto rounded-[var(--radius-md)] bg-surface-sunken p-3 font-mono text-xs leading-relaxed">
        {q.data.length ? q.data.map((l, i) => <div key={i} className={l.type === 'stderr' ? 'text-danger' : undefined}><span className="select-none text-subtle">{new Date(l.at).toLocaleTimeString()} </span>{l.text}</div>) : <span className="text-subtle">No log lines yet.</span>}
      </pre>
    </div>
  );
}

function Domains({ projectId, domains, canUse, deployed, configured, onChange }: { projectId: string; domains: HostedDomain[]; canUse: boolean; deployed: boolean; configured: boolean; onChange: () => void }) {
  const confirm = useConfirm();
  const [host, setHost] = useState('');
  const add = useMutation({ mutationFn: () => hostingApi.addDomain(projectId, host.trim().toLowerCase()), onSuccess: () => { setHost(''); toast.success('Domain added — now update your DNS'); onChange(); }, onError: (e) => toast.error((e as Error).message) });
  const check = useMutation({ mutationFn: (h: string) => hostingApi.checkDomain(projectId, h), onSuccess: (d) => { toast[d.status === 'active' ? 'success' : 'message'](d.status === 'active' ? `${d.hostname} is live with SSL` : 'DNS isn’t pointing at the site yet. Changes can take up to 48 hours.'); onChange(); }, onError: (e) => toast.error((e as Error).message) });
  const remove = useMutation({ mutationFn: (h: string) => hostingApi.removeDomain(projectId, h), onSuccess: () => { toast.success('Domain removed'); onChange(); }, onError: (e) => toast.error((e as Error).message) });
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast.success('Copied'); } catch { toast.error('Couldn’t copy'); } };
  if (!canUse) return <HostingUpgrade what="Custom domains with automatic SSL are included from the Pro plan." />;
  return (
    <div className="space-y-4">
      <Card>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (host.trim()) add.mutate(); }}>
          <Field label="Add a domain you own" className="flex-1"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="www.yourbusiness.com" autoCapitalize="none" spellCheck={false} disabled={!deployed || !configured} /></Field>
          <Button type="submit" disabled={!host.trim() || !deployed || !configured} loading={add.isPending}>Add domain</Button>
        </form>
        {!deployed && <p className="mt-2 text-[13px] text-muted">Deploy once before connecting a domain.</p>}
      </Card>
      {domains.length === 0 ? <Card padded={false}><EmptyState compact icon={<Globe className="size-5" />} title="No custom domains" body="Your site is available on its provider URL. Add your own domain above." /></Card> : domains.map((d) => (
        <Card key={d.hostname} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{d.hostname}</span>
            <StatusBadge status={d.status} />
            {d.status === 'active' && <Badge tone="success"><Lock className="size-3" />SSL</Badge>}
            <div className="ml-auto flex gap-1.5">
              <Button size="xs" variant="secondary" loading={check.isPending && check.variables === d.hostname} onClick={() => check.mutate(d.hostname)}><RefreshCw className="size-3" />Check</Button>
              <Button size="xs" variant="ghost" onClick={async () => { const r = await confirm({ title: `Remove ${d.hostname}?`, body: 'Visitors using this domain will stop reaching the site.', confirmLabel: 'Remove', danger: true }); if (r.ok) remove.mutate(d.hostname); }}><Trash2 className="size-3" />Remove</Button>
            </div>
          </div>
          {d.status !== 'active' && d.records.length > 0 && (
            <div className="space-y-2">
              <p className="text-[13px] text-muted">Add these records at your domain provider (GoDaddy, Namecheap, Cloudflare…). SSL is issued automatically once they’re in place.</p>
              <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-surface-muted text-left text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Value</th><th className="px-3 py-2 font-medium">Why</th></tr></thead>
                  <tbody>{d.records.map((r) => <tr key={`${r.type}${r.name}`} className="border-t border-border"><td className="px-3 py-2 font-mono">{r.type}</td><td className="px-3 py-2 font-mono">{r.name}</td><td className="px-3 py-2"><button className="inline-flex items-center gap-1 font-mono hover:text-accent-text" onClick={() => copy(r.value)} title="Copy">{r.value}<Copy className="size-3" /></button></td><td className="px-3 py-2 text-muted">{r.reason}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function EnvVars({ projectId, vars, onChange }: { projectId: string; vars: { key: string; updatedAt: string; public: boolean }[]; onChange: () => void }) {
  const confirm = useConfirm();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const keyOk = /^[A-Z_][A-Z0-9_]{0,127}$/.test(key) && !/^(VERCEL|MYA|NOW)_/.test(key);
  const save = useMutation({ mutationFn: () => hostingApi.setEnv(projectId, key, value), onSuccess: () => { toast.success(`${key} saved — redeploy to apply`); setKey(''); setValue(''); onChange(); }, onError: (e) => toast.error((e as Error).message) });
  const del = useMutation({ mutationFn: (k: string) => hostingApi.deleteEnv(projectId, k), onSuccess: () => { toast.success('Variable deleted — redeploy to apply'); onChange(); }, onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (keyOk) save.mutate(); }}>
          <Field label="Name" error={key && !keyOk ? 'UPPER_SNAKE_CASE; VERCEL_, MYA_ and NOW_ are reserved' : null}><Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="RESEND_API_KEY" className="font-mono" autoCapitalize="characters" spellCheck={false} /></Field>
          <Field label="Value"><Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Stored encrypted" /></Field>
          <Button type="submit" disabled={!keyOk} loading={save.isPending}>Save</Button>
        </form>
        {key.startsWith('NEXT_PUBLIC_') && <Notice tone="warning">Variables starting with NEXT_PUBLIC_ are built into the website and visible to every visitor. Never put secrets in them.</Notice>}
        <p className="text-xs text-subtle">Values are encrypted and can’t be viewed again — only replaced. Changes apply on the next deployment.</p>
      </Card>
      <DataTable
        rows={vars}
        rowKey={(v) => v.key}
        empty={<Card padded={false}><EmptyState compact icon={<KeyRound className="size-5" />} title="No environment variables" body="Add API keys and settings your website needs. They’re sent to the hosting provider, never to visitors (unless NEXT_PUBLIC_)." /></Card>}
        columns={[
          { key: 'k', header: 'Name', cell: (v) => <span className="font-mono text-[13px]">{v.key}</span> },
          { key: 'v', header: 'Value', cell: (v) => <span className={cx('font-mono text-[13px]', v.public ? 'text-warning' : 'text-subtle')}>{v.public ? 'public · visible in browser' : '•••••••• encrypted'}</span> },
          { key: 'u', header: 'Updated', cell: (v) => <span className="text-muted">{timeAgo(v.updatedAt)}</span> },
          { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (v) => <Button size="xs" variant="ghost" onClick={async () => { const r = await confirm({ title: `Delete ${v.key}?`, body: 'The website loses this value on its next deployment.', confirmLabel: 'Delete', danger: true }); if (r.ok) del.mutate(v.key); }}><Trash2 className="size-3" />Delete</Button> },
        ]}
        mobile={{ primary: (v) => <span className="font-mono text-[13px]">{v.key}</span>, secondary: (v) => (v.public ? 'Public' : 'Encrypted') + ` · ${timeAgo(v.updatedAt)}`, trailing: (v) => <Button size="xs" variant="ghost" iconOnly aria-label={`Delete ${v.key}`} onClick={async () => { const r = await confirm({ title: `Delete ${v.key}?`, confirmLabel: 'Delete', danger: true }); if (r.ok) del.mutate(v.key); }}><Trash2 className="size-3.5" /></Button> }}
      />
    </div>
  );
}
