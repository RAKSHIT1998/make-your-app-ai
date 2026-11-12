'use client';

import { Check, Minus } from 'lucide-react';
import { useState } from 'react';
import type { Catalogue, PlanPrice } from '@/lib/api';
import { money } from '@/lib/api';
import { Badge, Button, cx, Segmented, SoonBadge } from './ui';

const FEATURE_LABELS: Record<string, string> = {
  website_generation: 'AI website generation',
  preview: 'Live previews',
  hosting_basic: 'Basic hosting allowance',
  hosting: 'Website deployment & hosting',
  full_stack: 'Full-stack generation',
  mobile_builds: 'iOS & Android builds',
  advanced_integrations: 'Advanced integrations',
  team_workspace: 'Team workspace & client projects',
};
/** What is actually shipped today. Everything else is labelled "soon" so we never sell unbuilt features. */
const LIVE_FEATURES = new Set(['website_generation']);
const LIVE_TYPES = new Set(['website', 'business_website']);
const TYPE_LABELS: Record<string, string> = { website: 'Websites', business_website: 'Business websites', ecommerce: 'Online stores', mobile_app: 'Mobile apps', saas: 'SaaS', custom_software: 'Custom software' };

export function PlanCards({ catalogue, currentCode, onChoose, busyPriceId }: { catalogue: Catalogue; currentCode?: string; onChoose: (price: PlanPrice) => void; busyPriceId?: string | null }) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const hasYearly = catalogue.plans.some((p) => p.prices.some((x) => x.interval === 'yearly'));
  return (
    <div className="space-y-5">
      {hasYearly && <div className="flex justify-center"><Segmented label="Billing interval" value={interval} onChange={setInterval} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} /></div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {catalogue.plans.map((p) => {
          const price = p.prices.find((x) => x.interval === interval) ?? p.prices.find((x) => x.interval === 'monthly');
          const isFree = p.prices.length === 0;
          const current = currentCode === p.code;
          const featured = p.code === 'pro';
          const live = p.projectTypes.filter((t) => LIVE_TYPES.has(t));
          const later = p.projectTypes.filter((t) => !LIVE_TYPES.has(t));
          return (
            <div key={p.id} className={cx('flex flex-col rounded-[var(--radius-lg)] border bg-surface p-5 shadow-sm', featured ? 'border-fg' : 'border-border')}>
              <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{p.name}</h3>{current ? <Badge tone="success">Current</Badge> : featured && <Badge tone="accent">Most popular</Badge>}</div>
              <p className="mt-1 min-h-10 text-[13px] text-muted">{p.description}</p>
              <div className="mt-4 flex items-baseline gap-1">
                {isFree ? <span className="text-3xl font-semibold tracking-[-0.03em]">Free</span> : price ? (
                  <><span className="text-3xl font-semibold tracking-[-0.03em] tabular-nums">{money(price.amountMinor, price.currency).replace(/\.00$/, '')}</span><span className="text-sm text-muted">/{price.interval === 'yearly' ? 'year' : 'month'}</span></>
                ) : <span className="text-sm text-muted">Not available {interval}</span>}
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-[13px]">
                <Item>{p.monthlyCredits.toLocaleString()} AI credits a month</Item>
                <Item>{p.maxActiveProjects} active project{p.maxActiveProjects === 1 ? '' : 's'}</Item>
                {p.dailyCreditLimit !== null && <Item>Up to {p.dailyCreditLimit.toLocaleString()} credits a day</Item>}
                {p.teamSeats > 1 && <Item>{p.teamSeats} team seats</Item>}
                {live.length > 0 && <Item>{live.map((t) => TYPE_LABELS[t] ?? t).join(', ')}</Item>}
                {later.length > 0 && <Item soon>{later.map((t) => TYPE_LABELS[t] ?? t).join(', ')}</Item>}
                {p.featureFlags.filter((f) => FEATURE_LABELS[f] && !LIVE_FEATURES.has(f)).map((f) => <Item key={f} soon>{FEATURE_LABELS[f]}</Item>)}
              </ul>
              <div className="mt-5">
                {current ? <Button variant="secondary" className="w-full" disabled>Your plan</Button> : isFree ? <Button variant="ghost" className="w-full" disabled>Included</Button> : price ? (
                  <Button className="w-full" variant={featured ? 'primary' : 'secondary'} onClick={() => onChoose(price)} loading={busyPriceId === price.id}>Choose {p.name}</Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs text-subtle">Prices include applicable taxes. Unused monthly credits don&apos;t roll over; purchased top-up credits never expire. Features marked “soon” aren&apos;t available yet.</p>
    </div>
  );
}

function Item({ children, soon }: { children: React.ReactNode; soon?: boolean }) {
  return (
    <li className={cx('flex items-start gap-2', soon && 'text-muted')}>
      {soon ? <Minus className="mt-0.5 size-3.5 shrink-0 text-subtle" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-success" />}
      <span>{children}{soon && <span className="ml-1.5 align-middle"><SoonBadge /></span>}</span>
    </li>
  );
}
