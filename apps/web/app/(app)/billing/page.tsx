'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Receipt } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PlanCards } from '@/components/plan-cards';
import { Button, Card, EmptyState, ErrorNotice, Skeleton, StatusBadge } from '@/components/ui';
import { billing, money, type CheckoutParams } from '@/lib/api';
import { openCheckout } from '@/lib/checkout';

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-muted">{label}</span><span className="font-medium">{used.toLocaleString()} / {total.toLocaleString()}</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={pct >= 90 ? 'h-full bg-warning' : 'h-full bg-brand'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BillingInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const overview = useQuery({ queryKey: ['billing'], queryFn: billing.overview });
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: billing.catalogue });
  const [pending, setPending] = useState<string | null>(params.get('checkout'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Poll until the provider's webhook confirms the payment server-side.
  const status = useQuery({
    queryKey: ['checkout', pending],
    queryFn: () => billing.checkout(pending!),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data?.status === 'created' ? 2000 : false),
  });
  useEffect(() => {
    if (status.data?.status === 'completed') {
      for (const k of ['billing', 'credits', 'catalogue']) void qc.invalidateQueries({ queryKey: [k] });
    }
  }, [status.data?.status, qc]);

  async function start(fn: () => Promise<CheckoutParams>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const p = await fn();
      setPending(p.checkoutId);
      router.replace(`/billing?checkout=${p.checkoutId}`);
      await openCheckout(p, () => undefined);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const cancel = useMutation({ mutationFn: billing.cancel, onSuccess: () => void qc.invalidateQueries({ queryKey: ['billing'] }) });
  const preselect = params.get('plan');
  useEffect(() => {
    if (preselect && !pending) void start(() => billing.subscribe(preselect), preselect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);

  if (overview.error) return <ErrorNotice error={overview.error} />;
  const o = overview.data;
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
      {pending && (
        <Card className="flex items-center gap-3 p-4 text-sm" >
          {status.data?.status === 'completed' ? <><CheckCircle2 className="size-5 text-success" /><span><span className="font-medium">Payment confirmed.</span> Your account has been updated.</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setPending(null); router.replace('/billing'); }}>Dismiss</Button></> : (
            <><Loader2 className="size-5 animate-spin text-brand" /><span>Waiting for the payment provider to confirm your payment. This page updates automatically — nothing changes until the payment is verified.</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setPending(null); router.replace('/billing'); }}>Hide</Button></>
          )}
        </Card>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      {!o ? <Skeleton className="h-40" /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="space-y-2 p-5">
            <div className="text-sm text-muted">Current plan</div>
            <div className="text-2xl font-semibold">{o.plan.name}</div>
            {o.subscription ? (
              <div className="space-y-1 text-sm text-muted">
                <div>{money(o.subscription.amountMinor ?? 0, o.subscription.currency ?? 'INR')} / {o.subscription.interval === 'yearly' ? 'year' : 'month'} · <StatusBadge status={o.subscription.status} /></div>
                {o.subscription.currentPeriodEnd && <div>{o.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on {new Date(o.subscription.currentPeriodEnd).toLocaleDateString()}</div>}
                {!o.subscription.cancelAtPeriodEnd && <Button size="sm" variant="ghost" className="-ml-3 text-danger" loading={cancel.isPending} onClick={() => { if (confirm('Cancel at the end of the current period? Your projects are kept; you move to Free afterwards.')) cancel.mutate(); }}>Cancel subscription</Button>}
                {cancel.error ? <ErrorNotice error={cancel.error} /> : null}
              </div>
            ) : <div className="text-sm text-muted">Free plan · allowance resets {o.period.end ? `on ${new Date(o.period.end).toLocaleDateString()}` : 'monthly'}</div>}
          </Card>
          <Card className="space-y-4 p-5">
            <div className="text-sm text-muted">AI credits</div>
            <div className="text-2xl font-semibold">{o.credits.total.toLocaleString()} <span className="text-base font-normal text-muted">available</span></div>
            <Meter label="Monthly allowance used" used={Math.max(0, o.entitlements.monthlyCredits - o.credits.allowanceRemaining)} total={o.entitlements.monthlyCredits} />
            <div className="flex justify-between text-sm"><span className="text-muted">Purchased (never expire)</span><span className="font-medium">{o.credits.purchasedRemaining.toLocaleString()}</span></div>
            {o.entitlements.dailyCreditLimit !== null && <div className="flex justify-between text-sm"><span className="text-muted">Used today</span><span className="font-medium">{o.credits.usedToday} / {o.entitlements.dailyCreditLimit}</span></div>}
          </Card>
          <Card className="space-y-4 p-5">
            <div className="text-sm text-muted">Usage</div>
            <Meter label="Active projects" used={o.usage.activeProjects} total={o.entitlements.maxActiveProjects} />
            {o.usage.activeProjects > o.entitlements.maxActiveProjects && <p className="text-sm text-warning">You&apos;re over your plan&apos;s project limit. Projects are safe; AI changes are paused until you archive some or upgrade.</p>}
            <div className="text-sm text-muted">Team seats: {o.entitlements.teamSeats}</div>
          </Card>
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Plans</h2>
        {catalogue.data && !catalogue.data.providers.razorpay && !catalogue.data.providers.stripe && <p className="text-sm text-warning">Payments are not configured on this server yet.</p>}
        {!catalogue.data ? <Skeleton className="h-80" /> : <PlanCards catalogue={catalogue.data} currentCode={o?.plan.code} busyPriceId={busy} onChoose={(price) => start(() => billing.subscribe(price.id), price.id)} />}
      </section>

      {catalogue.data && catalogue.data.creditPacks.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Top up credits</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {catalogue.data.creditPacks.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3 p-4">
                <div><div className="font-medium">{p.credits.toLocaleString()} credits</div><div className="text-sm text-muted">{money(p.priceMinor, p.currency)}</div></div>
                <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => start(() => billing.topup(p.id), p.id)}>Buy</Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Payment history</h2>
        {!o ? <Skeleton className="h-24" /> : o.invoices.length === 0 ? <Card><EmptyState icon={<Receipt className="size-5" />} title="No payments yet" body="Invoices for subscriptions and top-ups appear here." /></Card> : (
          <Card className="divide-y divide-border">
            {o.invoices.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <span className="font-mono text-xs text-muted">{i.number}</span>
                <span className="min-w-0 flex-1">{i.description}</span>
                <span className="text-muted">{new Date(i.paidAt).toLocaleDateString()}</span>
                <span className="font-medium">{money(i.totalMinor, i.currency)}</span>
                <StatusBadge status={i.status} />
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingInner />
    </Suspense>
  );
}
