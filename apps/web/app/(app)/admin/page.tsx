'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useState } from 'react';
import { Button, Card, ErrorNotice, Input, Skeleton, StatusBadge } from '@/components/ui';
import { admin, api, money, type AdminPlan } from '@/lib/api';

type Tab = 'overview' | 'plans' | 'customers' | 'audit';

export default function AdminPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [tab, setTab] = useState<Tab>('overview');
  if (me.data && me.data.platformRole === 'user') return <ErrorNotice error={new Error('Page not found.')} />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Owner console</h1>
        <p className="text-sm text-muted">Platform-wide business data. Every action here is audited.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface p-1" role="tablist">
        {(['overview', 'plans', 'customers', 'audit'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium capitalize', tab === t ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg')}>{t}</button>
        ))}
      </div>
      {tab === 'overview' ? <Overview /> : tab === 'plans' ? <Plans /> : tab === 'customers' ? <Customers /> : <Audit />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card className="p-4"><div className="text-sm text-muted">{label}</div><div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>{sub && <div className="mt-1 text-xs text-subtle">{sub}</div>}</Card>;
}

function Overview() {
  const o = useQuery({ queryKey: ['admin-overview'], queryFn: () => admin.overview(30) });
  if (o.error) return <ErrorNotice error={o.error} />;
  if (!o.data) return <Skeleton className="h-48" />;
  const d = o.data;
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(v, c)).join(' + ') || money(0, 'INR');
  const gens = d.generations;
  const totalGens = Object.values(gens).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="MRR" value={fmt(d.mrrMinor)} sub={`ARR ${fmt(d.arrMinor)}`} />
        <Stat label="Active subscriptions" value={String(d.subscriptions.active)} sub={Object.entries(d.subscriptions.byPlan).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'} />
        <Stat label="Users" value={String(d.users.total)} sub={`${d.users.new} new · ${d.users.active} active (30d)`} />
        <Stat label="AI cost (30d)" value={`$${d.ai.costUsd.toFixed(2)}`} sub={`${(d.ai.inputTokens + d.ai.outputTokens).toLocaleString()} tokens`} />
        <Stat label="Revenue (30d)" value={d.revenue.map((r) => money(r.grossMinor - r.refundsMinor, r.currency)).join(' + ') || money(0, 'INR')} sub={d.revenue.map((r) => `${r.invoices} invoices · fees ${money(r.feesMinor, r.currency)}`).join(' · ')} />
        <Stat label="Gross margin (INR, 30d)" value={d.grossMarginInr ? money(d.grossMarginInr.marginMinor, 'INR') : '—'} sub={d.grossMarginInr ? `AI cost ${money(d.grossMarginInr.aiCostMinor, 'INR')}` : 'Set REPORTING_USD_INR'} />
        <Stat label="Generations (30d)" value={String(totalGens)} sub={`${gens['succeeded'] ?? 0} succeeded · ${gens['failed'] ?? 0} failed`} />
        <Stat label="Churn & payment issues" value={String(d.subscriptions.cancellationsInPeriod)} sub={`${d.subscriptions.paymentProblems} past due / halted`} />
      </div>
      {d.notes.length > 0 && <Card className="p-4 text-sm text-muted"><ul className="list-disc space-y-1 pl-5">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul></Card>}
    </div>
  );
}

function PlanEditor({ plan }: { plan: AdminPlan }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ includedCredits: String(plan.includedCredits), maxProjects: String(plan.maxProjects), dailyCreditLimit: plan.dailyCreditLimit === null ? '' : String(plan.dailyCreditLimit), maxCreditsPerRun: String(plan.maxCreditsPerRun) });
  const save = useMutation({
    mutationFn: () => admin.updatePlan(plan.id, { includedCredits: Number(f.includedCredits), maxProjects: Number(f.maxProjects), dailyCreditLimit: f.dailyCreditLimit === '' ? null : Number(f.dailyCreditLimit), maxCreditsPerRun: Number(f.maxCreditsPerRun) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-plans'] }),
  });
  const toggle = useMutation({ mutationFn: () => admin.updatePlan(plan.id, { active: !plan.active }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-plans'] }) });
  const field = (k: keyof typeof f, label: string) => <label className="space-y-1"><span className="text-xs font-medium text-muted">{label}</span><Input aria-label={`${plan.name} ${label}`} inputMode="numeric" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2"><h3 className="font-semibold">{plan.name}</h3><span className="font-mono text-xs text-subtle">{plan.code}</span><StatusBadge status={plan.active ? 'active' : 'paused'} /><span className="ml-auto text-sm text-muted">{plan.activeSubscriptions} subscribers</span></div>
      <div className="text-sm text-muted">{plan.prices.length ? plan.prices.map((p) => `${money(p.amountMinor, p.currency)}/${p.interval === 'yearly' ? 'yr' : 'mo'}${p.active ? '' : ' (inactive)'}`).join(' · ') : 'No price (free)'}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{field('includedCredits', 'Credits / month')}{field('maxProjects', 'Active projects')}{field('dailyCreditLimit', 'Daily credit limit')}{field('maxCreditsPerRun', 'Max credits / run')}</div>
      {(save.error || toggle.error) ? <ErrorNotice error={save.error ?? toggle.error} /> : null}
      <div className="flex gap-2"><Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Save limits</Button>{plan.code !== 'free' && <Button size="sm" variant="secondary" onClick={() => toggle.mutate()} loading={toggle.isPending}>{plan.active ? 'Hide plan' : 'Activate plan'}</Button>}{save.isSuccess && <span className="self-center text-sm text-success">Saved</span>}</div>
    </Card>
  );
}

function Plans() {
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: admin.plans });
  if (plans.error) return <ErrorNotice error={plans.error} />;
  if (!plans.data) return <Skeleton className="h-64" />;
  return <div className="space-y-3"><p className="text-sm text-muted">Changes apply to new billing periods. Prices are immutable for existing subscribers — create a new plan version to change a price.</p>{plans.data.map((p) => <PlanEditor key={p.id} plan={p} />)}</div>;
}

function Customers() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const users = useQuery({ queryKey: ['admin-users', search], queryFn: () => admin.users(search) });
  const status = useMutation({ mutationFn: ({ id, suspend }: { id: string; suspend: boolean }) => admin.setStatus(id, suspend, prompt('Reason (recorded in the audit log)') ?? ''), onSettled: () => void qc.invalidateQueries({ queryKey: ['admin-users'] }) });
  const credit = useMutation({ mutationFn: ({ orgId }: { orgId: string }) => admin.credits(orgId, Number(prompt('Credits to add (negative to remove)') ?? 0), prompt('Reason') ?? ''), onSettled: () => void qc.invalidateQueries({ queryKey: ['admin-users'] }) });
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}><Input placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)} /><Button type="submit" variant="secondary">Search</Button></form>
      {(status.error || credit.error) ? <ErrorNotice error={status.error ?? credit.error} /> : null}
      {!users.data ? <Skeleton className="h-48" /> : (
        <Card className="divide-y divide-border overflow-x-auto">
          {users.data.map((u) => (
            <div key={u.id} className="flex min-w-[720px] items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{u.email}</div><div className="text-xs text-subtle">joined {new Date(u.createdAt).toLocaleDateString()} · {u.projects} projects{u.platformRole !== 'user' ? ` · ${u.platformRole}` : ''}</div></div>
              <span className="w-16 capitalize">{u.plan}</span>
              <span className="w-28 text-right">{u.revenue.map((r) => money(r.netMinor, r.currency)).join(' + ') || '—'}</span>
              <span className="w-20 text-right text-muted">${u.aiCostUsd.toFixed(2)} AI</span>
              <StatusBadge status={u.status === 'active' ? 'active' : 'failed'} />
              {u.organizationId && <Button size="sm" variant="ghost" onClick={() => credit.mutate({ orgId: u.organizationId! })}>Credits</Button>}
              <Button size="sm" variant={u.status === 'active' ? 'ghost' : 'secondary'} onClick={() => status.mutate({ id: u.id, suspend: u.status === 'active' })}>{u.status === 'active' ? 'Suspend' : 'Restore'}</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Audit() {
  const log = useQuery({ queryKey: ['admin-audit'], queryFn: admin.audit });
  if (!log.data) return <Skeleton className="h-48" />;
  return (
    <Card className="divide-y divide-border">
      {log.data.map((l) => <div key={l.id} className="flex gap-3 p-3 text-sm"><span className="w-40 shrink-0 text-muted">{new Date(l.createdAt).toLocaleString()}</span><span className="font-mono text-xs">{l.action}</span><span className="ml-auto text-muted">{l.actor ?? 'system'}</span></div>)}
    </Card>
  );
}
