'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, Menu, MenuItem, PageHeader, Segmented, Skeleton, Stat, StatusBadge, Tabs, toast, useConfirm } from '@/components/ui';
import { DataTable } from '@/components/ui/table';
import Link from 'next/link';
import { admin, api, flags as flagsApi, growthAdmin, templatesApi, money, type AdminPlan, type AdminUser, type GrowthSettings } from '@/lib/api';

type Tab = 'overview' | 'plans' | 'customers' | 'growth' | 'templates' | 'flags' | 'audit';
const intOk = (v: string, allowNeg = false) => (allowNeg ? /^-?\d+$/ : /^\d+$/).test(v.trim());

export default function AdminPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [tab, setTab] = useState<Tab>('overview');
  if (me.data && me.data.platformRole === 'user') return <Card padded={false}><EmptyState title="Page not found" body="This page doesn't exist or you don't have access." /></Card>;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Owner" title="Owner console" description={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" />Platform-wide business data. Every action is recorded in the audit log.</span>} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} items={[{ value: 'overview', label: 'Overview' }, { value: 'plans', label: 'Plans' }, { value: 'customers', label: 'Customers' }, { value: 'growth', label: 'Growth' }, { value: 'templates', label: 'Templates' }, { value: 'flags', label: 'Feature flags' }, { value: 'audit', label: 'Audit log' }]} />
      {tab === 'overview' ? <Overview /> : tab === 'plans' ? <Plans /> : tab === 'customers' ? <Customers /> : tab === 'growth' ? <Growth /> : tab === 'flags' ? <Flags /> : tab === 'templates' ? <TemplateReviews /> : <Audit />}
    </div>
  );
}

function Overview() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const o = useQuery({ queryKey: ['admin-overview', days], queryFn: () => admin.overview(Number(days)), placeholderData: (p) => p });
  if (o.error) return <ErrorNotice error={o.error} onRetry={() => o.refetch()} />;
  if (!o.data) return <Skeleton className="h-64" />;
  const d = o.data;
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(v, c)).join(' + ') || money(0, 'INR');
  const totalGens = Object.values(d.generations).reduce((a, b) => a + b, 0);
  const tiles = [
    { label: 'MRR', value: fmt(d.mrrMinor), hint: `ARR ${fmt(d.arrMinor)}` },
    { label: 'Active subscriptions', value: d.subscriptions.active, hint: Object.entries(d.subscriptions.byPlan).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet' },
    { label: 'Users', value: d.users.total, hint: `${d.users.new} new · ${d.users.active} active` },
    { label: 'AI cost', value: `$${d.ai.costUsd.toFixed(2)}`, hint: `${(d.ai.inputTokens + d.ai.outputTokens).toLocaleString()} tokens` },
    { label: 'Net revenue', value: d.revenue.map((r) => money(r.grossMinor - r.refundsMinor, r.currency)).join(' + ') || money(0, 'INR'), hint: d.revenue.map((r) => `${r.invoices} invoices · fees ${money(r.feesMinor, r.currency)}`).join(' · ') || 'no invoices' },
    { label: 'Gross margin (INR)', value: d.grossMarginInr ? money(d.grossMarginInr.marginMinor, 'INR') : '—', hint: d.grossMarginInr ? `AI cost ${money(d.grossMarginInr.aiCostMinor, 'INR')}` : 'Set REPORTING_USD_INR' },
    { label: 'Generations', value: totalGens, hint: `${d.generations['succeeded'] ?? 0} succeeded · ${d.generations['failed'] ?? 0} failed` },
    { label: 'Cancellations', value: d.subscriptions.cancellationsInPeriod, hint: `${d.subscriptions.paymentProblems} past due / halted` },
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} /></div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border shadow-sm lg:grid-cols-4">
        {tiles.map((t) => <div key={t.label} className="bg-surface p-5"><Stat label={t.label} value={t.value} hint={t.hint} /></div>)}
      </div>
      {d.notes.length > 0 && <Card className="text-[13px] text-muted"><ul className="list-disc space-y-1 pl-5">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul></Card>}
    </div>
  );
}

function PlanEditor({ plan }: { plan: AdminPlan }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const initial = { includedCredits: String(plan.includedCredits), maxProjects: String(plan.maxProjects), dailyCreditLimit: plan.dailyCreditLimit === null ? '' : String(plan.dailyCreditLimit), maxCreditsPerRun: String(plan.maxCreditsPerRun) };
  const [f, setF] = useState(initial);
  const valid = intOk(f.includedCredits) && intOk(f.maxProjects) && intOk(f.maxCreditsPerRun) && (f.dailyCreditLimit === '' || intOk(f.dailyCreditLimit));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () => admin.updatePlan(plan.id, { includedCredits: Number(f.includedCredits), maxProjects: Number(f.maxProjects), dailyCreditLimit: f.dailyCreditLimit === '' ? null : Number(f.dailyCreditLimit), maxCreditsPerRun: Number(f.maxCreditsPerRun) }),
    onSuccess: () => { toast.success(`${plan.name} limits saved`); void qc.invalidateQueries({ queryKey: ['admin-plans'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const toggle = useMutation({
    mutationFn: () => admin.updatePlan(plan.id, { active: !plan.active }),
    onSuccess: () => { toast.success(plan.active ? `${plan.name} hidden` : `${plan.name} activated`); void qc.invalidateQueries({ queryKey: ['admin-plans'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const field = (k: keyof typeof f, label: string, hint?: string) => <Field label={label} hint={hint}><Input aria-label={`${plan.name} ${label}`} inputMode="numeric" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{plan.name}</h3><span className="font-mono text-xs text-subtle">{plan.code}</span>
        <Badge tone={plan.active ? 'success' : 'neutral'} dot>{plan.active ? 'Active' : 'Hidden'}</Badge>
        <span className="ml-auto text-[13px] text-muted">{plan.activeSubscriptions} subscriber{plan.activeSubscriptions === 1 ? '' : 's'}</span>
      </div>
      <div className="text-[13px] text-muted">{plan.prices.length ? plan.prices.map((p) => `${money(p.amountMinor, p.currency)}/${p.interval === 'yearly' ? 'yr' : 'mo'}${p.active ? '' : ' (inactive)'}`).join(' · ') : 'No price (free)'}</div>
      {plan.prices.length > 0 && <StripePrices plan={plan} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{field('includedCredits', 'Credits / month')}{field('maxProjects', 'Active projects')}{field('dailyCreditLimit', 'Daily limit', 'Empty = none')}{field('maxCreditsPerRun', 'Max / run')}</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={!valid || !dirty} loading={save.isPending}>Save limits</Button>
        {plan.code !== 'free' && <Button size="sm" variant="secondary" loading={toggle.isPending} onClick={async () => {
          if (plan.active) { const r = await confirm({ title: `Hide ${plan.name}?`, body: 'New customers won\'t see or buy it. Existing subscribers keep their plan.', confirmLabel: 'Hide plan', danger: true }); if (!r.ok) return; }
          toggle.mutate();
        }}>{plan.active ? 'Hide plan' : 'Activate plan'}</Button>}
      </div>
    </Card>
  );
}

/** Stripe needs a recurring Price created in its dashboard; Razorpay plans are created automatically on first checkout. */
function StripePrices({ plan }: { plan: AdminPlan }) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="text-[13px] font-medium">Stripe price ids</div>
      <p className="text-[13px] text-muted">Create a recurring Price in Stripe with the same amount, currency and interval, then paste its id. Razorpay plans are created automatically on the first checkout.</p>
      {plan.prices.map((p) => <StripePriceRow key={p.id} planName={plan.name} price={p} />)}
    </div>
  );
}

function StripePriceRow({ planName, price }: { planName: string; price: AdminPlan['prices'][number] }) {
  const qc = useQueryClient();
  const [v, setV] = useState(price.stripePriceId ?? '');
  const label = `${money(price.amountMinor, price.currency)}/${price.interval === 'yearly' ? 'yr' : 'mo'}`;
  const trimmed = v.trim();
  const valid = trimmed === '' || /^price_[A-Za-z0-9]+$/.test(trimmed);
  const save = useMutation({
    mutationFn: () => admin.updatePrice(price.id, { stripePriceId: trimmed === '' ? null : trimmed }),
    onSuccess: () => { toast.success(`${planName} ${label}: Stripe price saved`); void qc.invalidateQueries({ queryKey: ['admin-plans'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field label={label} error={valid ? null : 'Must start with price_'} hint={price.razorpayPlanId ? `Razorpay plan ${price.razorpayPlanId}` : undefined} className="min-w-0 flex-1">
        <Input aria-label={`${planName} ${label} Stripe price id`} placeholder="price_…" value={v} onChange={(e) => setV(e.target.value)} className="font-mono" />
      </Field>
      <Button size="sm" variant="secondary" disabled={!valid || trimmed === (price.stripePriceId ?? '')} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
    </div>
  );
}

function Plans() {
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: admin.plans });
  if (plans.error) return <ErrorNotice error={plans.error} onRetry={() => plans.refetch()} />;
  if (!plans.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">Limit changes apply from each customer's next billing period. Prices are immutable for existing subscribers — create a new plan version to change a price.</p>
      {plans.data.map((p) => <PlanEditor key={p.id} plan={p} />)}
    </div>
  );
}

function Customers() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [creditFor, setCreditFor] = useState<AdminUser | null>(null);
  const users = useQuery({ queryKey: ['admin-users', search], queryFn: () => admin.users(search) });
  const status = useMutation({
    mutationFn: ({ u, suspend, reason }: { u: AdminUser; suspend: boolean; reason: string }) => admin.setStatus(u.id, suspend, reason),
    onSuccess: (_, v) => toast.success(v.suspend ? `${v.u.email} suspended` : `${v.u.email} restored`),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const setUserStatus = async (u: AdminUser, suspend: boolean) => {
    const r = await confirm({ title: suspend ? `Suspend ${u.email}?` : `Restore ${u.email}?`, body: suspend ? 'They lose access immediately and can\'t use the product until restored.' : 'They regain access immediately.', confirmLabel: suspend ? 'Suspend' : 'Restore', danger: suspend, input: { label: 'Reason (recorded in the audit log)', required: true } });
    if (r.ok) status.mutate({ u, suspend, reason: r.value.trim() });
  };
  const actions = (u: AdminUser) => (
    <Menu trigger={<Button size="sm" variant="ghost" iconOnly aria-label={`Actions for ${u.email}`}><MoreHorizontal className="size-4" /></Button>}>
      {u.organizationId && <MenuItem onSelect={() => setCreditFor(u)}>Adjust credits…</MenuItem>}
      <MenuItem danger={u.status === 'active'} onSelect={() => void setUserStatus(u, u.status === 'active')}>{u.status === 'active' ? 'Suspend…' : 'Restore…'}</MenuItem>
    </Menu>
  );
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" /><Input aria-label="Search customers" placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {users.error ? <ErrorNotice error={users.error} onRetry={() => users.refetch()} /> : !users.data ? <Skeleton className="h-48" /> : (
        <DataTable
          rows={users.data}
          rowKey={(u) => u.id}
          empty={<Card padded={false}><EmptyState compact title="No customers found" /></Card>}
          columns={[
            { key: 'e', header: 'Customer', cell: (u) => <div className="min-w-0"><div className="max-w-[260px] truncate font-medium">{u.email}</div><div className="text-xs text-subtle">joined {new Date(u.createdAt).toLocaleDateString()}{u.platformRole !== 'user' ? ` · ${u.platformRole}` : ''}</div></div> },
            { key: 'p', header: 'Plan', cell: (u) => <span className="capitalize">{u.plan}</span> },
            { key: 'n', header: 'Projects', align: 'right', cell: (u) => <span className="tabular-nums">{u.projects}</span> },
            { key: 'r', header: 'Revenue', align: 'right', cell: (u) => <span className="tabular-nums">{u.revenue.map((r) => money(r.netMinor, r.currency)).join(' + ') || '—'}</span> },
            { key: 'a', header: 'AI cost', align: 'right', cell: (u) => <span className="tabular-nums text-muted">${u.aiCostUsd.toFixed(2)}</span> },
            { key: 's', header: 'Status', cell: (u) => <Badge tone={u.status === 'active' ? 'success' : 'danger'} dot>{u.status === 'active' ? 'Active' : 'Suspended'}</Badge> },
            { key: 'x', header: <span className="sr-only">Actions</span>, align: 'right', cell: actions },
          ]}
          mobile={{ primary: (u) => u.email, secondary: (u) => `${u.plan} · ${u.projects} projects · $${u.aiCostUsd.toFixed(2)} AI`, trailing: (u) => <div className="flex items-center gap-1"><StatusBadge status={u.status === 'active' ? 'active' : 'failed'} />{actions(u)}</div> }}
        />
      )}
      <CreditDialog user={creditFor} onClose={() => setCreditFor(null)} />
    </div>
  );
}

function CreditDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const valid = intOk(amount, true) && Number(amount) !== 0 && reason.trim().length >= 3;
  const grant = useMutation({
    mutationFn: () => admin.credits(user!.organizationId!, Number(amount), reason.trim()),
    onSuccess: () => { toast.success(`${Number(amount) > 0 ? 'Added' : 'Removed'} ${Math.abs(Number(amount))} credits`); setAmount(''); setReason(''); onClose(); void qc.invalidateQueries({ queryKey: ['admin-users'] }); },
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()} title="Adjust credits" description={user?.email} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={grant.isPending} onClick={() => grant.mutate()}>Apply</Button></>}>
      <div className="space-y-4">
        <Field label="Credits" hint="Use a negative number to remove credits. Applied to the top-up bucket."><Input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" /></Field>
        <Field label="Reason" hint="Recorded in the audit log."><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill credit for failed build" /></Field>
        {grant.error ? <ErrorNotice error={grant.error} /> : null}
      </div>
    </Dialog>
  );
}

function Audit() {
  const log = useQuery({ queryKey: ['admin-audit'], queryFn: admin.audit });
  if (log.error) return <ErrorNotice error={log.error} onRetry={() => log.refetch()} />;
  if (!log.data) return <Skeleton className="h-48" />;
  return (
    <DataTable
      rows={log.data}
      rowKey={(l) => l.id}
      empty={<Card padded={false}><EmptyState compact title="No audited actions yet" /></Card>}
      columns={[
        { key: 't', header: 'When', cell: (l) => <span className="whitespace-nowrap text-muted">{new Date(l.createdAt).toLocaleString()}</span> },
        { key: 'a', header: 'Action', cell: (l) => <span className="font-mono text-xs">{l.action}</span> },
        { key: 'g', header: 'Target', cell: (l) => <span className="text-muted">{l.targetType ?? '—'}</span> },
        { key: 'u', header: 'Actor', align: 'right', cell: (l) => <span className="text-muted">{l.actor ?? 'system'}</span> },
      ]}
      mobile={{ primary: (l) => <span className="font-mono text-xs">{l.action}</span>, secondary: (l) => `${new Date(l.createdAt).toLocaleString()} · ${l.actor ?? 'system'}` }}
    />
  );
}

function Growth() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const ref = useQuery({ queryKey: ['admin-referrals'], queryFn: growthAdmin.referrals });
  const show = useQuery({ queryKey: ['admin-showcase'], queryFn: growthAdmin.showcase });
  const [f, setF] = useState<Record<keyof GrowthSettings, string> | null>(null);
  const s = ref.data?.settings;
  const form = f ?? (s ? { referralsEnabled: String(s.referralsEnabled), referrerRewardCredits: String(s.referrerRewardCredits), referredRewardCredits: String(s.referredRewardCredits), maxRewardsPerMonth: String(s.maxRewardsPerMonth), claimWindowDays: String(s.claimWindowDays) } : null);
  const valid = !!form && (['referrerRewardCredits', 'referredRewardCredits', 'maxRewardsPerMonth', 'claimWindowDays'] as const).every((k) => intOk(form[k])) && Number(form.claimWindowDays) >= 1;
  const saveSettings = useMutation({
    mutationFn: () => growthAdmin.updateSettings({ referralsEnabled: form!.referralsEnabled === 'true', referrerRewardCredits: Number(form!.referrerRewardCredits), referredRewardCredits: Number(form!.referredRewardCredits), maxRewardsPerMonth: Number(form!.maxRewardsPerMonth), claimWindowDays: Number(form!.claimWindowDays) }),
    onSuccess: () => { setF(null); toast.success('Referral settings saved'); void qc.invalidateQueries({ queryKey: ['admin-referrals'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const act = useMutation({
    mutationFn: ({ fn }: { fn: () => Promise<unknown>; msg: string }) => fn(),
    onSuccess: (_, v) => { toast.success(v.msg); void qc.invalidateQueries({ queryKey: ['admin-showcase'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const hide = async (id: string, title: string) => {
    const r = await confirm({ title: `Hide “${title}”?`, body: 'It disappears from Explore and its public page. The creator can’t republish it until you restore it.', confirmLabel: 'Hide project', danger: true, input: { label: 'Note (shown to the creator)', required: true } });
    if (r.ok) act.mutate({ fn: () => growthAdmin.hide(id, r.value.trim()), msg: 'Project hidden' });
  };
  const field = (k: keyof GrowthSettings, label: string, hint?: string) => <Field label={label} hint={hint}><Input inputMode="numeric" value={form![k]} onChange={(e) => setF({ ...form!, [k]: e.target.value })} /></Field>;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Referral programme</h2>
        {ref.error ? <ErrorNotice error={ref.error} /> : !form || !ref.data ? <Skeleton className="h-40" /> : (
          <>
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented label="Programme" value={form.referralsEnabled} onChange={(v) => setF({ ...form, referralsEnabled: v })} options={[{ value: 'true', label: 'On' }, { value: 'false', label: 'Paused' }]} />
                <span className="text-[13px] text-muted">{['pending', 'rewarded', 'rejected'].map((k) => `${ref.data.counts[k] ?? 0} ${k}`).join(' · ')}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {field('referrerRewardCredits', 'Referrer credits')}{field('referredRewardCredits', 'New user credits')}{field('maxRewardsPerMonth', 'Max rewards / month', 'Per referrer')}{field('claimWindowDays', 'Claim window (days)', 'After sign-up')}
              </div>
              <p className="text-[13px] text-muted">Rewards are paid only after the invited user’s first verified payment, as never-expiring credits.</p>
              <Button size="sm" disabled={!valid || !f} loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>Save settings</Button>
            </Card>
            <DataTable
              rows={ref.data.recent}
              rowKey={(r) => r.id}
              empty={<Card padded={false}><EmptyState compact title="No referrals yet" /></Card>}
              columns={[
                { key: 'f', header: 'Referrer', cell: (r) => <span className="block max-w-[220px] truncate">{r.referrer}</span> },
                { key: 't', header: 'Invited', cell: (r) => <span className="block max-w-[220px] truncate">{r.referred}</span> },
                { key: 's', header: 'Status', cell: (r) => <span className="capitalize">{r.status}{r.rejectReason ? <span className="text-muted"> · {r.rejectReason.replaceAll('_', ' ')}</span> : null}</span> },
                { key: 'c', header: 'Credits paid', align: 'right', cell: (r) => <span className="tabular-nums">{r.credits || '—'}</span> },
              ]}
              mobile={{ primary: (r) => `${r.referrer} → ${r.referred}`, secondary: (r) => r.status, trailing: (r) => <span className="tabular-nums">{r.credits || '—'}</span> }}
            />
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Reports</h2>
        {show.error ? <ErrorNotice error={show.error} /> : !show.data ? <Skeleton className="h-32" /> : (
          <DataTable
            rows={show.data.reports}
            rowKey={(r) => r.id}
            empty={<Card padded={false}><EmptyState compact title="No open reports" /></Card>}
            columns={[
              { key: 'p', header: 'Project', cell: (r) => <div>{r.project.slug ? <Link className="font-medium hover:underline" href={`/p/${r.project.slug}`} target="_blank">{r.project.title}</Link> : r.project.title}<div className="text-xs text-muted">@{r.project.creator}{r.project.hidden ? ' · hidden' : ''}</div></div> },
              { key: 'r', header: 'Reason', cell: (r) => <div><span className="capitalize">{r.reason}</span>{r.details && <div className="max-w-[280px] truncate text-xs text-muted">{r.details}</div>}</div> },
              { key: 'b', header: 'Reporter', cell: (r) => <span className="text-muted">{r.reporter}</span> },
              { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (r) => <div className="flex justify-end gap-1.5">{!r.project.hidden && <Button size="xs" variant="danger" onClick={() => void hide(r.project.id, r.project.title)}>Hide</Button>}{r.project.hidden && <Button size="xs" variant="secondary" onClick={() => act.mutate({ fn: () => growthAdmin.restore(r.project.id), msg: 'Project restored' })}>Restore</Button>}<Button size="xs" variant="ghost" onClick={() => act.mutate({ fn: () => growthAdmin.dismiss(r.id), msg: 'Report dismissed' })}>Dismiss</Button></div> },
            ]}
            mobile={{ primary: (r) => r.project.title, secondary: (r) => `${r.reason} · ${r.reporter}`, trailing: (r) => <Button size="xs" variant="ghost" onClick={() => act.mutate({ fn: () => growthAdmin.dismiss(r.id), msg: 'Report dismissed' })}>Dismiss</Button> }}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Published projects</h2>
        {show.data && (
          <DataTable
            rows={show.data.published}
            rowKey={(p) => p.id}
            empty={<Card padded={false}><EmptyState compact title="Nothing published yet" /></Card>}
            columns={[
              { key: 't', header: 'Project', cell: (p) => <div>{p.slug ? <Link className="font-medium hover:underline" href={`/p/${p.slug}`} target="_blank">{p.title}</Link> : p.title}<div className="text-xs text-muted">@{p.creator}</div></div> },
              { key: 'e', header: 'Engagement', cell: (p) => <span className="text-muted tabular-nums">{p.likes} likes · {p.views} views · {p.remixes} remixes</span> },
              { key: 's', header: 'Status', cell: (p) => p.hidden ? <Badge tone="danger">Hidden</Badge> : p.featured ? <Badge tone="accent">Featured</Badge> : <Badge>Public</Badge> },
              { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (p) => (
                <div className="flex justify-end gap-1.5">
                  {!p.hidden && <Button size="xs" variant="secondary" onClick={() => act.mutate({ fn: () => growthAdmin.feature(p.id, !p.featured), msg: p.featured ? 'Removed from Featured' : 'Featured in Explore' })}>{p.featured ? 'Unfeature' : 'Feature'}</Button>}
                  {p.hidden ? <Button size="xs" variant="secondary" onClick={() => act.mutate({ fn: () => growthAdmin.restore(p.id), msg: 'Project restored' })}>Restore</Button> : <Button size="xs" variant="danger" onClick={() => void hide(p.id, p.title)}>Hide</Button>}
                </div>
              ) },
            ]}
            mobile={{ primary: (p) => p.title, secondary: (p) => `@${p.creator} · ${p.likes} likes`, trailing: (p) => <Button size="xs" variant="secondary" onClick={() => act.mutate({ fn: () => growthAdmin.feature(p.id, !p.featured), msg: p.featured ? 'Removed from Featured' : 'Featured in Explore' })}>{p.featured ? 'Unfeature' : 'Feature'}</Button> }}
          />
        )}
      </section>
    </div>
  );
}

function Flags() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ['admin-flags'], queryFn: flagsApi.admin });
  const set = useMutation({
    mutationFn: ({ key, enabled }: { key: Parameters<typeof flagsApi.set>[0]; enabled: boolean }) => flagsApi.set(key, enabled),
    onSuccess: (_, v) => { toast.success(`${v.key.replaceAll('_', ' ')} ${v.enabled ? 'enabled' : 'disabled'}`); void qc.invalidateQueries({ queryKey: ['admin-flags'] }); void qc.invalidateQueries({ queryKey: ['flags'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">Platform-wide switches, enforced by the API for everyone (changes apply within a few seconds). Plan entitlements stay on each plan.</p>
      <Card padded={false}>
        <ul className="divide-y divide-border">
          {list.data.map((f) => (
            <li key={f.key} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="font-mono text-[13px] font-medium">{f.key}</span>{f.enabled !== f.default && <Badge tone="warning">Changed</Badge>}</div>
                <div className="mt-0.5 text-[13px] text-muted">{f.description}</div>
              </div>
              <Segmented label={f.key} value={f.enabled ? 'on' : 'off'} onChange={async (v) => {
                if (v === 'off') { const r = await confirm({ title: `Turn off ${f.key.replaceAll('_', ' ')}?`, body: 'Customers will see that this feature is temporarily unavailable.', confirmLabel: 'Turn off', danger: true }); if (!r.ok) return; }
                set.mutate({ key: f.key, enabled: v === 'on' });
              }} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function TemplateReviews() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const q = useQuery({ queryKey: ['admin-templates', status], queryFn: () => templatesApi.queue(status) });
  const act = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject' | 'feature' | 'unfeature'; note?: string }) => templatesApi.review(id, decision, note),
    onSuccess: (_, v) => { toast.success({ approve: 'Template approved', reject: 'Template rejected', feature: 'Template featured', unfeature: 'Removed from featured' }[v.decision]); void qc.invalidateQueries({ queryKey: ['admin-templates'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="space-y-3">
      <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Waiting' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} />
      {q.error ? <ErrorNotice error={q.error} /> : !q.data ? <Skeleton className="h-40" /> : (
        <DataTable
          rows={q.data}
          rowKey={(t) => t.id}
          empty={<Card padded={false}><EmptyState compact title={status === 'pending' ? 'Nothing waiting for review' : 'None'} /></Card>}
          columns={[
            { key: 't', header: 'Template', cell: (t) => <div>{t.projectSlug ? <Link className="font-medium hover:underline" href={`/p/${t.projectSlug}`} target="_blank">{t.title}</Link> : <span className="font-medium">{t.title}</span>}<div className="max-w-[320px] truncate text-xs text-muted">{t.description}</div></div> },
            { key: 'c', header: 'Creator', cell: (t) => <span className="text-muted">@{t.creator.handle}</span> },
            { key: 'p', header: 'Pages', align: 'right', cell: (t) => <span className="tabular-nums">{t.pageCount}</span> },
            { key: 'u', header: 'Uses', align: 'right', cell: (t) => <span className="tabular-nums">{t.uses}</span> },
            { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (t) => (
              <div className="flex justify-end gap-1.5">
                {t.status !== 'approved' && <Button size="xs" onClick={() => act.mutate({ id: t.id, decision: 'approve' })}>Approve</Button>}
                {t.status === 'approved' && <Button size="xs" variant="secondary" onClick={() => act.mutate({ id: t.id, decision: t.featured ? 'unfeature' : 'feature' })}>{t.featured ? 'Unfeature' : 'Feature'}</Button>}
                {t.status !== 'rejected' && <Button size="xs" variant="danger" onClick={async () => { const r = await confirm({ title: `Reject “${t.title}”?`, confirmLabel: 'Reject', danger: true, input: { label: 'Reason (shown to the creator)', required: true } }); if (r.ok) act.mutate({ id: t.id, decision: 'reject', note: r.value.trim() }); }}>Reject</Button>}
              </div>
            ) },
          ]}
          mobile={{ primary: (t) => t.title, secondary: (t) => `@${t.creator.handle} · ${t.uses} uses`, trailing: (t) => t.status !== 'approved' ? <Button size="xs" onClick={() => act.mutate({ id: t.id, decision: 'approve' })}>Approve</Button> : null }}
        />
      )}
    </div>
  );
}
