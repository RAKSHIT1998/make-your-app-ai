'use client';

import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { useState } from 'react';
import type { Catalogue, PlanPrice } from '@/lib/api';
import { money } from '@/lib/api';
import { Button, Card } from './ui';

const FEATURE_LABELS: Record<string, string> = {
  website_generation: 'AI website generation',
  preview: 'Previews',
  hosting_basic: 'Basic hosting allowance',
  hosting: 'Website deployment & hosting',
  full_stack: 'Full-stack generation',
  mobile_builds: 'iOS & Android builds',
  advanced_integrations: 'Advanced integrations',
  team_workspace: 'Team workspace & client projects',
};
/** What is actually shipped today. Everything else is shown as "coming soon" so we never sell unbuilt features. */
const LIVE_FEATURES = new Set(['website_generation']);
const LIVE_TYPES = new Set(['website', 'business_website']);
const Soon = () => <span className="ml-1 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] text-subtle">coming soon</span>;

const TYPE_LABELS: Record<string, string> = { website: 'Websites', business_website: 'Business websites', ecommerce: 'Online stores', mobile_app: 'Mobile apps', saas: 'SaaS', custom_software: 'Custom software' };

export function PlanCards({ catalogue, currentCode, onChoose, busyPriceId }: { catalogue: Catalogue; currentCode?: string; onChoose: (price: PlanPrice) => void; busyPriceId?: string | null }) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const hasYearly = catalogue.plans.some((p) => p.prices.some((x) => x.interval === 'yearly'));
  return (
    <div className="space-y-5">
      {hasYearly && (
        <div className="flex justify-center">
          <div className="inline-flex rounded-full border border-border bg-surface p-1" role="radiogroup" aria-label="Billing interval">
            {(['monthly', 'yearly'] as const).map((i) => (
              <button key={i} role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={clsx('rounded-full px-4 py-1.5 text-sm font-medium capitalize', interval === i ? 'bg-brand text-brand-fg' : 'text-muted')}>{i}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {catalogue.plans.map((p) => {
          const price = p.prices.find((x) => x.interval === interval) ?? p.prices.find((x) => x.interval === 'monthly');
          const isFree = p.prices.length === 0;
          const current = currentCode === p.code;
          const featured = p.code === 'pro';
          return (
            <Card key={p.id} className={clsx('flex flex-col p-5', featured && 'border-brand ring-1 ring-brand')}>
              <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{p.name}</h3>{featured && <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">Most popular</span>}</div>
              <p className="mt-1 min-h-10 text-sm text-muted">{p.description}</p>
              <div className="mt-4">
                {isFree ? <span className="text-3xl font-semibold">₹0</span> : price ? (
                  <><span className="text-3xl font-semibold">{money(price.amountMinor, price.currency).replace(/\.00$/, '')}</span><span className="text-sm text-muted">/{price.interval === 'yearly' ? 'year' : 'month'}</span></>
                ) : <span className="text-sm text-muted">Not available {interval}</span>}
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-success" />{p.monthlyCredits.toLocaleString()} AI credits / month</li>
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-success" />{p.maxActiveProjects} active project{p.maxActiveProjects === 1 ? '' : 's'}</li>
                {p.teamSeats > 1 && <li className="flex gap-2"><Check className="size-4 shrink-0 text-success" />{p.teamSeats} team seats</li>}
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-success" /><span>AI generation: {p.projectTypes.filter((t) => LIVE_TYPES.has(t)).map((t) => TYPE_LABELS[t] ?? t).join(', ')}</span></li>
                {p.projectTypes.some((t) => !LIVE_TYPES.has(t)) && <li className="flex gap-2 text-muted"><Check className="size-4 shrink-0 text-subtle" /><span>{p.projectTypes.filter((t) => !LIVE_TYPES.has(t)).map((t) => TYPE_LABELS[t] ?? t).join(', ')}<Soon /></span></li>}
                {p.featureFlags.filter((f) => FEATURE_LABELS[f] && !LIVE_FEATURES.has(f)).map((f) => <li key={f} className="flex gap-2 text-muted"><Check className="size-4 shrink-0 text-subtle" /><span>{FEATURE_LABELS[f]}<Soon /></span></li>)}
              </ul>
              <div className="mt-5">
                {current ? <Button variant="secondary" className="w-full" disabled>Current plan</Button> : isFree ? <Button variant="secondary" className="w-full" disabled>Included</Button> : price ? (
                  <Button className="w-full" variant={featured ? 'primary' : 'secondary'} onClick={() => onChoose(price)} loading={busyPriceId === price.id}>Choose {p.name}</Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-center text-xs text-subtle">Prices include applicable taxes. AI credits measure AI usage; unused monthly credits don&apos;t roll over. Purchased top-up credits never expire.</p>
    </div>
  );
}
