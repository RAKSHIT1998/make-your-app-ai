'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { admin, money, type AdminAnalytics } from '@/lib/api';
import { Card, cx, ErrorNotice, Segmented, Skeleton, Stat } from './ui';
import { Bars, Breakdown, total, type Point } from './charts';


const TYPE: Record<string, string> = { website: 'Websites', business_website: 'Business sites', mobile_app: 'Mobile apps', game: 'Games', custom_software: 'Web apps', ecommerce: 'Stores', saas: 'Full-stack apps' };

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
