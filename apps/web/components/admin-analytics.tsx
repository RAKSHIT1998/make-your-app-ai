'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { admin, money, type AdminAnalytics } from '@/lib/api';
import { Card, cx, ErrorNotice, Segmented, Skeleton, Stat } from './ui';

type Point = { day: string; value: number };
const total = (s: Point[]) => s.reduce((n, p) => n + p.value, 0);
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A plain daily bar chart. Each bar is focusable and carries its exact value, so nothing depends on colour or hover. */
function Bars({ title, series, format = (n) => n.toLocaleString(), second }: { title: string; series: Point[]; format?: (n: number) => string; second?: { label: string; series: Point[] } }) {
  const max = Math.max(1, ...series.map((p) => p.value + (second?.series.find((x) => x.day === p.day)?.value ?? 0)));
  const sum = total(series);
  return (
    <Card className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-sm tabular-nums text-muted">{format(sum)}{second ? ` · ${total(second.series).toLocaleString()} ${second.label}` : ''}</span>
      </div>
      {sum === 0 && (!second || total(second.series) === 0) ? <p className="mt-6 pb-6 text-center text-sm text-muted">Nothing in this period yet.</p> : (
        <>
          <ul className="mt-4 flex h-28 items-end gap-px" aria-label={`${title} per day`}>
            {series.map((p) => {
              const b = second?.series.find((x) => x.day === p.day)?.value ?? 0;
              const label = `${dayLabel(p.day)}: ${format(p.value)}${second ? `, ${b} ${second.label}` : ''}`;
              return (
                <li key={p.day} title={label} aria-label={label} tabIndex={0} className="group flex h-full min-w-0 flex-1 flex-col justify-end outline-none">
                  {b > 0 && <span className="w-full rounded-t-[2px] bg-danger/70" style={{ height: `${(b / max) * 100}%` }} />}
                  <span className={cx('w-full bg-fg/80 group-hover:bg-accent group-focus-visible:bg-accent', b > 0 ? '' : 'rounded-t-[2px]')} style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 2 : 0 }} />
                </li>
              );
            })}
          </ul>
          <div className="mt-1.5 flex justify-between text-xs text-subtle"><span>{dayLabel(series[0]!.day)}</span><span>{dayLabel(series.at(-1)!.day)}</span></div>
        </>
      )}
    </Card>
  );
}

function Breakdown({ title, rows, empty }: { title: string; rows: { label: string; value: number; display?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="min-w-0">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="space-y-2.5 text-sm">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between gap-3"><span className={cx('truncate', !r.label.includes('@') && 'capitalize')}>{r.label}</span><span className="shrink-0 tabular-nums">{r.display ?? r.value.toLocaleString()}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-fg/70" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const TYPE: Record<string, string> = { website: 'Websites', business_website: 'Business sites', mobile_app: 'Mobile apps', game: 'Games', custom_software: 'Web apps', ecommerce: 'Stores', saas: 'SaaS' };

export function AdminAnalyticsPanel() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const q = useQuery({ queryKey: ['admin-analytics', days], queryFn: () => admin.analytics(Number(days)), placeholderData: (p) => p });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const a: AdminAnalytics = q.data;
  const stores = a.customerStores;
  const shipped = Object.entries(stores.shipments).filter(([k]) => k !== 'cancelled').reduce((n, [, v]) => n + v, 0);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} /></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {a.revenue.length === 0 ? <Bars title="Your revenue" series={a.series.signups.map((p) => ({ ...p, value: 0 }))} /> : a.revenue.map((r) => <Bars key={r.currency} title={`Your revenue (${r.currency}, net of refunds)`} series={r.daily} format={(n) => money(n, r.currency)} />)}
        <Bars title="New sign-ups" series={a.series.signups} />
        <Bars title="Projects created" series={a.series.projects} />
        <Bars title="AI builds" series={a.series.buildsSucceeded} second={{ label: 'failed', series: a.series.buildsFailed }} />
        <Bars title="Credits spent by customers" series={a.series.creditsSpent} />
        <Breakdown title="What people build" rows={a.projectsByType.map((t) => ({ label: TYPE[t.type] ?? t.type.replaceAll('_', ' '), value: t.count }))} empty="No projects yet." />
      </div>

      <Card>
        <h3 className="text-sm font-semibold">Customer stores</h3>
        <p className="mt-0.5 text-[13px] text-muted">Sales made by your customers through their own payment accounts. This is their money, not platform revenue.</p>
        <div className="mt-4 grid grid-cols-2 gap-5 lg:grid-cols-4">
          <Stat label="Live stores" value={stores.byStatus.active ?? 0} hint={`${Object.values(stores.byStatus).reduce((x, y) => x + y, 0)} in total`} />
          <Stat label="Sales through stores" value={stores.sales.map((s) => money(s.grossMinor - s.refundedMinor, s.currency)).join(' + ') || money(0, 'INR')} hint="net of refunds" />
          <Stat label="Paid orders" value={stores.sales.reduce((n, s) => n + s.orders, 0)} />
          <Stat label="Parcels booked" value={shipped} hint={`${stores.shipments.delivered ?? 0} delivered`} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Breakdown title="Extensions in use" rows={a.extensions.map((e) => ({ label: e.provider, value: e.workspaces, display: `${e.workspaces} workspace${e.workspaces === 1 ? '' : 's'}` }))} empty="No extension is connected yet." />
        <Breakdown title="Top workspaces by AI use" rows={a.topWorkspaces.map((t) => ({ label: t.owner ?? t.name, value: t.credits, display: `${t.credits.toLocaleString()} cr · $${t.aiCostUsd.toFixed(2)}` }))} empty="No AI use in this period." />
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Quality</h3>
          <div className="space-y-4">
            <Stat label="Failed builds refunded" value={a.failedBuildRefunds.runs} hint={`${a.failedBuildRefunds.credits.toLocaleString()} credits returned`} />
            <Stat label="Published projects" value={a.publishedProjects} hint="with a public page" />
          </div>
        </Card>
      </div>
      <p className="text-xs text-subtle">Days are in UTC. Every figure is counted from live records.</p>
    </div>
  );
}
