'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Database, Download, ExternalLink, Eye, Heart, MessageCircle, Pause, Play, ShieldCheck, ShoppingCart, Trash2, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { Badge, Button, Card, ErrorNotice, Field, LinkButton, Meter, Notice, PageHeader, Segmented, Skeleton, Stat, Textarea, toast, Toggle, useConfirm } from '@/components/ui';
import { Bars, Breakdown } from '@/components/charts';
import { ApiError, money, ownerDashboard, type DayValue, type OwnerDashboard } from '@/lib/api';

type Days = '7' | '30' | '90';

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return <span className={up ? 'text-success' : 'text-danger'}>{up ? '▲' : '▼'} {Math.abs(pct)}% vs previous period</span>;
}

/** The owner's view of one thing they built: who comes, who signs up, what's stored, what it earns, and the switches. */
export default function ProjectDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [days, setDays] = useState<Days>('30');
  const q = useQuery({ queryKey: ['owner-dashboard', id, days], queryFn: () => ownerDashboard.get(id, Number(days)), refetchInterval: 60_000 });
  const d = q.data;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <Link href={`/projects/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" />Back to the builder</Link>
      <div className="mb-6"><PageHeader
        eyebrow="Dashboard"
        title={d?.project.name ?? 'Your project'}
        description="Visitors, users, data and money for what you built — and the controls to run it."
        actions={<Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />}
      /></div>
      {q.error ? <ErrorNotice error={q.error} onRetry={() => q.refetch()} /> : !d ? <DashboardSkeleton /> : <Body d={d} projectId={id} />}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
    </div>
  );
}

function Body({ d, projectId }: { d: OwnerDashboard; projectId: string }) {
  const m = d.money;
  return (
    <div className="space-y-6">
      <StatusCard d={d} projectId={projectId} />

      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label={`Visitors · ${d.days} days`} value={d.visitors.total.toLocaleString()} hint={<Change pct={d.visitors.changePct} />} />
          {d.appUsers ? <Stat label="App users" value={d.appUsers.total.toLocaleString()} hint={`${d.appUsers.newInPeriod.toLocaleString()} new in this period`} /> : <Stat label="All-time visitors" value={d.visitors.allTime.toLocaleString()} />}
          {m ? <Stat label="Net sales" value={money(m.netSalesMinor, m.currency)} hint={`${m.orders.toLocaleString()} paid orders`} /> : <Stat label="Likes" value={d.visitors.likes.toLocaleString()} />}
          {d.data ? <Stat label="Records stored" value={d.data.total.toLocaleString()} hint={`${d.data.newInPeriod.toLocaleString()} new in this period`} /> : <Stat label="Comments" value={d.visitors.comments.toLocaleString()} />}
        </div>
      </Card>

      <section aria-labelledby="audience" className="space-y-3">
        <h2 id="audience" className="flex items-center gap-2 text-base font-semibold"><Eye className="size-4" />Audience</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Bars title="Unique visitors per day" series={d.visitors.daily} />
          {d.appUsers ? <Bars title="New sign-ups per day" series={d.appUsers.daily} /> : (
            <Card>
              <h3 className="text-sm font-semibold">Engagement</h3>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted"><Eye className="size-4" />All-time visitors</span><span className="tabular-nums">{d.visitors.allTime.toLocaleString()}</span></li>
                <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted"><Heart className="size-4" />Likes</span><span className="tabular-nums">{d.visitors.likes.toLocaleString()}</span></li>
                <li className="flex items-center justify-between"><span className="flex items-center gap-2 text-muted"><MessageCircle className="size-4" />Comments</span><span className="tabular-nums">{d.visitors.comments.toLocaleString()}</span></li>
              </ul>
            </Card>
          )}
        </div>
        <p className="text-xs text-subtle">Visitors are people who opened your public page, counted once per person per day. Your own and your team's visits aren't counted, and no cookies are used.</p>
      </section>

      {d.controls?.teamOnly && <TeamSection projectId={projectId} />}
      {d.appUsers && <UsersSection d={d} projectId={projectId} />}
      {d.data && <DataSection d={d} projectId={projectId} />}
      {m ? <MoneySection d={d} /> : <NoStore d={d} />}
      {d.controls && <ControlsSection d={d} projectId={projectId} />}
    </div>
  );
}

function StatusCard({ d, projectId }: { d: OwnerDashboard; projectId: string }) {
  const p = d.project;
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {p.hidden ? <Badge tone="danger" dot>Hidden by moderation</Badge> : p.live ? <Badge tone="success" dot pulse>Live</Badge> : <Badge dot>Not published</Badge>}
          {d.controls?.paused && <Badge tone="warning" dot>Paused</Badge>}
          {p.publishedVersion && <span className="text-sm text-muted">Version {p.publishedVersion}{p.publishedAt ? ` · published ${new Date(p.publishedAt).toLocaleDateString()}` : ''}</span>}
        </div>
        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-sm font-medium hover:underline">{p.url.replace(/^https?:\/\//, '')}<ExternalLink className="size-3.5 shrink-0" /></a>}
        {!p.live && !p.hidden && <p className="mt-1.5 text-sm text-muted">Publish it to start collecting visitors, users and sales.</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <LinkButton href={`/projects/${projectId}`} variant="secondary" size="sm">Open builder</LinkButton>
        {p.url && <a href={p.url} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="size-3.5" />View live</Button></a>}
      </div>
    </Card>
  );
}

function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Download failed. Please try again.'); } finally { setBusy(null); }
  };
  return { busy, run };
}

function UsersSection({ d, projectId }: { d: OwnerDashboard; projectId: string }) {
  const u = d.appUsers!;
  const dl = useDownload();
  return (
    <section aria-labelledby="users" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="users" className="flex items-center gap-2 text-base font-semibold"><Users className="size-4" />Your app's users</h2>
        <Button size="sm" variant="secondary" loading={dl.busy === 'users'} disabled={u.total === 0} onClick={() => dl.run('users', () => ownerDashboard.exportUsers(projectId))}><Download className="size-3.5" />Export CSV</Button>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Total accounts" value={u.total.toLocaleString()} />
          <Stat label={`New · ${d.days} days`} value={u.newInPeriod.toLocaleString()} hint={<Change pct={u.changePct} />} />
          <Stat label="Active · 7 days" value={u.active7.toLocaleString()} hint="signed in this week" />
          <Stat label="Active · 30 days" value={u.active30.toLocaleString()} />
        </div>
        <div className="mt-5"><Meter label="Accounts used" value={u.total} max={u.limit} /></div>
      </Card>
      <p className="text-xs text-subtle">To see or remove individual users, open the Data tab in the builder.</p>
    </section>
  );
}

function DataSection({ d, projectId }: { d: OwnerDashboard; projectId: string }) {
  const data = d.data!;
  const dl = useDownload();
  return (
    <section aria-labelledby="data" className="space-y-3">
      <h2 id="data" className="flex items-center gap-2 text-base font-semibold"><Database className="size-4" />Data</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="New records per day" series={data.daily} />
        <Card className="min-w-0">
          <h3 className="mb-3 text-sm font-semibold">By collection</h3>
          {data.collections.length === 0 ? <p className="text-sm text-muted">This app doesn't store data.</p> : (
            <ul className="divide-y divide-border text-sm">
              {data.collections.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="flex shrink-0 items-center gap-3"><span className="tabular-nums text-muted">{c.records.toLocaleString()}</span>
                    <Button size="sm" variant="ghost" aria-label={`Export ${c.name} as CSV`} loading={dl.busy === c.name} disabled={c.records === 0} onClick={() => dl.run(c.name, () => ownerDashboard.exportRecords(projectId, c.name))}><Download className="size-3.5" /></Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4"><Meter label="Storage used" value={data.total} max={data.limit} /></div>
        </Card>
      </div>
    </section>
  );
}

function MoneySection({ d }: { d: OwnerDashboard }) {
  const m = d.money!;
  const revenue: DayValue[] = d.visitors.daily.map((p) => ({ day: p.day, value: m.daily.find((x) => x.day === p.day)?.revenueMinor ?? 0 }));
  const orders: DayValue[] = d.visitors.daily.map((p) => ({ day: p.day, value: m.daily.find((x) => x.day === p.day)?.orders ?? 0 }));
  const conversion = d.visitors.total > 0 ? Math.round((m.orders / d.visitors.total) * 1000) / 10 : null;
  return (
    <section aria-labelledby="money" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="money" className="flex items-center gap-2 text-base font-semibold"><ShoppingCart className="size-4" />Money · {m.store.name}</h2>
        <LinkButton href={`/stores/${m.store.id}`} variant="secondary" size="sm">Manage store</LinkButton>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Gross sales" value={money(m.grossSalesMinor, m.currency)} />
          <Stat label="Refunds" value={money(m.refundsMinor, m.currency)} />
          <Stat label="Average order" value={money(m.averageOrderValueMinor, m.currency)} />
          <Stat label="Visitors who bought" value={conversion === null ? '—' : `${conversion}%`} hint="paid orders ÷ visitors" />
        </div>
        {m.pendingPaymentOrders > 0 && <div className="mt-4"><Notice tone="warning">{m.pendingPaymentOrders} order{m.pendingPaymentOrders === 1 ? ' is' : 's are'} waiting for payment.</Notice></div>}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="Revenue per day" series={revenue} format={(n) => money(n, m.currency)} />
        <Bars title="Paid orders per day" series={orders} />
      </div>
      <Breakdown title="Top products" empty="No sales in this period yet." rows={m.topProducts.map((t) => ({ label: t.productTitle, value: t.revenueMinor, display: `${money(t.revenueMinor, m.currency)} · ${t.units} sold` }))} />
    </section>
  );
}

function NoStore({ d }: { d: OwnerDashboard }) {
  if (d.project.type !== 'ecommerce') return null;
  return <Notice tone="info" action={<LinkButton href="/stores" size="sm" variant="secondary">Set up a store</LinkButton>}>Connect a store to this project to sell and see your sales here.</Notice>;
}

function ControlsSection({ d, projectId }: { d: OwnerDashboard; projectId: string }) {
  const c = d.controls!;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const save = useMutation({
    mutationFn: (patch: { signupsOpen?: boolean; paused?: boolean }) => ownerDashboard.setControls(projectId, patch),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['owner-dashboard', projectId] });
      toast.success(r.paused ? 'Your app is paused.' : 'Saved.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Please try again.'),
  });
  // Show the switch in its new position while saving; the server's answer then confirms it (or the error toast explains).
  const pending = save.isPending ? save.variables : undefined;
  const signupsOpen = pending?.signupsOpen ?? c.signupsOpen;
  const togglePause = async () => {
    if (!c.paused) {
      const ok = await confirm({ title: 'Pause your live app?', body: 'Visitors can still open the page, but signing in and loading or saving data will stop until you resume. Nothing is deleted.', confirmLabel: 'Pause app', danger: true });
      if (!ok.ok) return;
    }
    save.mutate({ paused: !c.paused });
  };
  return (
    <section aria-labelledby="controls" className="space-y-3">
      <h2 id="controls" className="text-base font-semibold">Controls</h2>
      <Card className="space-y-5">
        {c.hasAccounts && (
          <Toggle checked={signupsOpen} disabled={save.isPending} onChange={(v) => save.mutate({ signupsOpen: v })}
            label="Allow new sign-ups" hint={signupsOpen ? 'Anyone can create an account on your live app.' : 'New accounts are blocked. Existing users can still sign in.'} />
        )}
        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <div className="font-medium">{c.paused ? 'Your app is paused' : 'Pause the live app'}</div>
            <div className="text-[13px] text-muted">{c.paused ? 'Sign-ins and data are offline for visitors. Your preview still works.' : 'Takes sign-ins and data offline for maintenance or emergencies, without deleting anything.'}</div>
          </div>
          <Button variant={c.paused ? 'primary' : 'secondary'} size="sm" loading={save.isPending} onClick={togglePause}>
            {c.paused ? <><Play className="size-3.5" />Resume app</> : <><Pause className="size-3.5" />Pause app</>}
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-subtle"><UserPlus className="size-3.5" />Changes apply to your live app immediately and are recorded in your workspace's audit log.</p>
      </Card>
    </section>
  );
}

function TeamSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [emails, setEmails] = useState('');
  const team = useQuery({ queryKey: ['app-team', projectId], queryFn: () => ownerDashboard.team(projectId) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['app-team', projectId] }), qc.invalidateQueries({ queryKey: ['owner-dashboard', projectId] })]);
  const add = useMutation({
    mutationFn: (list: string[]) => ownerDashboard.teamAdd(projectId, list),
    onSuccess: async (r) => { setEmails(''); await refresh(); toast.success(r.added ? `Added ${r.added} ${r.added === 1 ? 'person' : 'people'}.` : 'They were already on the team.'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not add. Please try again.'),
  });
  const remove = useMutation({
    mutationFn: (email: string) => ownerDashboard.teamRemove(projectId, email),
    onSuccess: async () => { await refresh(); toast.success('Removed. They were signed out.'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not remove. Please try again.'),
  });
  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
  return (
    <section aria-labelledby="team" className="space-y-3">
      <h2 id="team" className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-4" />Team access</h2>
      <Card className="space-y-5">
        <p className="text-sm text-muted">This is a team-only app: only the emails below can create an account or stay signed in on your live app. Add yourself too.</p>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (list.length) add.mutate(list); }}>
          <Field label="Add people by email" hint="Separate several with commas or new lines." className="flex-1">
            <Textarea rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="priya@yourshop.in, rahul@yourshop.in" />
          </Field>
          <Button type="submit" loading={add.isPending} disabled={!list.length}><UserPlus className="size-3.5" />Add</Button>
        </form>
        {team.error ? <ErrorNotice error={team.error} onRetry={() => team.refetch()} /> : !team.data ? <Skeleton className="h-16" /> : team.data.length === 0 ? (
          <Notice tone="warning">Nobody can sign in to your live app yet. Add your staff's emails, then share the app's link with them.</Notice>
        ) : (
          <ul className="divide-y divide-border text-sm" aria-label="Team members">
            {team.data.map((m) => (
              <li key={m.email} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.email}</span>
                  <span className="text-xs text-subtle">{m.hasAccount ? (m.lastSignInAt ? `Last signed in ${new Date(m.lastSignInAt).toLocaleDateString()}` : 'Has an account') : 'Invited · no account yet'}</span>
                </span>
                <Button size="sm" variant="ghost" aria-label={`Remove ${m.email}`} disabled={remove.isPending} onClick={async () => {
                  const ok = await confirm({ title: `Remove ${m.email}?`, body: 'They are signed out at once and can no longer sign in. Records they created stay in the app.', confirmLabel: 'Remove', danger: true });
                  if (ok.ok) remove.mutate(m.email);
                }}><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

