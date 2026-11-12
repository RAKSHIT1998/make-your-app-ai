'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, HelpCircle, Loader2, Receipt, Server, Smartphone } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PlanCards } from '@/components/plan-cards';
import { Badge, Button, Card, EmptyState, ErrorNotice, Meter, Notice, PageHeader, SectionTitle, Skeleton, SoonBadge, StatusBadge, toast, useConfirm } from '@/components/ui';
import { DataTable } from '@/components/ui/table';
import { billing, money, type CheckoutParams, type UsageEntry } from '@/lib/api';
import { openCheckout } from '@/lib/checkout';

const REASONS: Record<string, string> = { plan_grant: 'Monthly allowance', purchase: 'Credit top-up', ai_usage: 'AI usage', infra_usage: 'Infrastructure', refund: 'Refund', adjustment: 'Adjustment', expiry: 'Allowance reset', referral: 'Referral bonus' };
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function BillingInner() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const params = useSearchParams();
  const router = useRouter();
  const overview = useQuery({ queryKey: ['billing'], queryFn: billing.overview });
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: billing.catalogue });
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: () => billing.usage(50) });
  const [pending, setPending] = useState<string | null>(params.get('checkout'));
  const [busy, setBusy] = useState<string | null>(null);
  const [allUsage, setAllUsage] = useState(false);

  // Poll until the provider's signed webhook confirms the payment server-side. The browser never grants anything itself.
  const status = useQuery({
    queryKey: ['checkout', pending],
    queryFn: () => billing.checkout(pending!),
    enabled: !!pending,
    refetchInterval: (q) => (q.state.data?.status === 'created' ? 2000 : false),
  });
  useEffect(() => {
    if (status.data?.status === 'completed') {
      for (const k of ['billing', 'credits', 'catalogue', 'estimate']) void qc.invalidateQueries({ queryKey: [k] });
      toast.success('Payment confirmed — your account is updated');
    }
  }, [status.data?.status, qc]);

  async function start(fn: () => Promise<CheckoutParams>, key: string) {
    setBusy(key);
    try {
      const p = await fn();
      setPending(p.checkoutId);
      router.replace(`/billing?checkout=${p.checkoutId}`);
      await openCheckout(p, () => undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const cancel = useMutation({
    mutationFn: billing.cancel,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['billing'] }); toast.success('Subscription will end at the close of this period'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const preselect = params.get('plan');
  useEffect(() => {
    if (preselect && !pending) void start(() => billing.subscribe(preselect), preselect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect]);

  const dismiss = () => { setPending(null); router.replace('/billing'); };
  if (overview.error) return <ErrorNotice error={overview.error} onRetry={() => overview.refetch()} />;
  const o = overview.data;
  const noProviders = catalogue.data && !catalogue.data.providers.razorpay && !catalogue.data.providers.stripe;

  return (
    <div className="space-y-10">
      <PageHeader title="Billing" description="Your plan, AI credits, usage and payments." />

      {pending && (
        <Card className="flex items-start gap-3 text-sm sm:items-center" padded>
          {status.data?.status === 'completed' ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : status.data && status.data.status !== 'created' ? <HelpCircle className="size-5 shrink-0 text-warning" /> : <Loader2 className="size-5 shrink-0 animate-spin text-accent" />}
          <span className="flex-1">
            {status.data?.status === 'completed' ? <><span className="font-medium">Payment confirmed.</span> Your plan and credits are updated.</>
              : status.data && status.data.status !== 'created' ? <>This checkout {status.data.status}. Nothing was charged to your plan — you can try again.</>
              : <>Waiting for the payment provider to confirm. This updates automatically; nothing changes until the payment is verified.</>}
          </span>
          <Button size="sm" variant="ghost" onClick={dismiss}>{status.data?.status === 'completed' ? 'Dismiss' : 'Hide'}</Button>
        </Card>
      )}

      {!o ? <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-[var(--radius-lg)]" />)}</div> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card className="flex flex-col">
            <div className="text-[13px] text-muted">Current plan</div>
            <div className="mt-1 flex items-center gap-2"><span className="text-2xl font-semibold tracking-[-0.02em]">{o.plan.name}</span>{o.subscription && <StatusBadge status={o.subscription.status} />}</div>
            {o.subscription ? (
              <div className="mt-2 space-y-1 text-sm text-muted">
                <div className="tabular-nums">{money(o.subscription.amountMinor ?? 0, o.subscription.currency ?? 'INR')} / {o.subscription.interval === 'yearly' ? 'year' : 'month'} · via <span className="capitalize">{o.subscription.provider}</span></div>
                {o.subscription.currentPeriodEnd && <div>{o.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on {date(o.subscription.currentPeriodEnd)}</div>}
              </div>
            ) : <div className="mt-2 text-sm text-muted">Allowance resets {o.period.end ? `on ${date(o.period.end)}` : 'monthly'}</div>}
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              <Button size="sm" variant="secondary" onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}>{o.subscription ? 'Change plan' : 'Upgrade'}</Button>
              {o.subscription && !o.subscription.cancelAtPeriodEnd && (
                <Button size="sm" variant="ghost" className="text-danger" loading={cancel.isPending} onClick={async () => {
                  const r = await confirm({ title: 'Cancel your subscription?', body: `You keep ${o.plan.name} until ${o.subscription?.currentPeriodEnd ? date(o.subscription.currentPeriodEnd) : 'the end of this period'}, then move to Free. Your projects are kept.`, confirmLabel: 'Cancel subscription', cancelLabel: 'Keep plan', danger: true });
                  if (r.ok) cancel.mutate();
                }}>Cancel</Button>
              )}
            </div>
          </Card>

          <Card className="space-y-4">
            <div>
              <div className="text-[13px] text-muted">AI credits available</div>
              <div className="mt-1 text-2xl font-semibold tracking-[-0.02em] tabular-nums">{o.credits.total.toLocaleString()}</div>
            </div>
            <Meter label="Monthly allowance used" value={Math.max(0, o.entitlements.monthlyCredits - o.credits.allowanceRemaining)} max={o.entitlements.monthlyCredits} />
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted">Top-up credits (never expire)</dt><dd className="font-medium tabular-nums">{o.credits.purchasedRemaining.toLocaleString()}</dd></div>
              {o.entitlements.dailyCreditLimit !== null && <div className="flex justify-between"><dt className="text-muted">Used today</dt><dd className="font-medium tabular-nums">{o.credits.usedToday} / {o.entitlements.dailyCreditLimit}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Max per AI run</dt><dd className="font-medium tabular-nums">{o.entitlements.maxCreditsPerRun}</dd></div>
            </dl>
          </Card>

          <Card className="space-y-4">
            <div className="text-[13px] text-muted">Plan usage</div>
            <Meter label="Active projects" value={o.usage.activeProjects} max={o.entitlements.maxActiveProjects} />
            {o.usage.activeProjects > o.entitlements.maxActiveProjects && <Notice tone="warning">You're over your project limit. Projects are safe; AI changes pause until you archive some or upgrade.</Notice>}
            <ul className="space-y-2.5 text-[13px]">
              <li className="flex items-center gap-2"><span className="flex-1 text-muted">Team seats</span><span className="font-medium tabular-nums">{o.entitlements.teamSeats}</span></li>
              <li className="flex items-center gap-2"><Smartphone className="size-3.5 text-subtle" /><span className="flex-1 text-muted">App build credits</span><SoonBadge /></li>
              <li className="flex items-center gap-2"><Server className="size-3.5 text-subtle" /><span className="flex-1 text-muted">Hosting usage</span><SoonBadge /></li>
            </ul>
          </Card>
        </div>
      )}

      <section>
        <SectionTitle>How credits work</SectionTitle>
        <Card className="grid grid-cols-1 gap-5 text-[13px] text-muted md:grid-cols-3">
          <p><span className="block font-medium text-fg">Credits measure AI work.</span>Each generation or edit uses credits based on how much the AI actually processed. You see the cost on every run.</p>
          <p><span className="block font-medium text-fg">Allowance first, then top-ups.</span>Your monthly allowance is used before purchased credits. The allowance resets each period and doesn't roll over.</p>
          <p><span className="block font-medium text-fg">Never surprise charges.</span>Runs stop at your plan's per-run and daily limits. You're only billed for your plan and the top-ups you buy.</p>
        </Card>
      </section>

      <section>
        <SectionTitle>Usage history</SectionTitle>
        {usage.error ? <ErrorNotice error={usage.error} onRetry={() => usage.refetch()} /> : !usage.data ? <Skeleton className="h-40" /> : (
          <DataTable<UsageEntry>
            rows={allUsage ? usage.data : usage.data.slice(0, 10)}
            rowKey={(u) => u.id}
            empty={<Card padded={false}><EmptyState compact title="No credit activity yet" body="Every credit grant, top-up and AI run appears here." /></Card>}
            columns={[
              { key: 'd', header: 'Date', cell: (u) => <span className="text-muted">{date(u.createdAt)}</span> },
              { key: 'r', header: 'Activity', cell: (u) => <div className="min-w-0"><div>{REASONS[u.reason] ?? u.reason}</div>{u.detail && <div className="max-w-[340px] truncate text-xs text-muted">{u.detail}</div>}</div> },
              { key: 'b', header: 'Bucket', cell: (u) => <Badge>{u.bucket === 'purchased' ? 'Top-up' : 'Allowance'}</Badge> },
              { key: 'a', header: 'Credits', align: 'right', cell: (u) => <span className={u.amount > 0 ? 'font-medium tabular-nums text-success' : 'tabular-nums'}>{u.amount > 0 ? '+' : ''}{u.amount.toLocaleString()}</span> },
            ]}
            mobile={{ primary: (u) => REASONS[u.reason] ?? u.reason, secondary: (u) => `${date(u.createdAt)}${u.detail ? ` · ${u.detail}` : ''}`, trailing: (u) => <span className={u.amount > 0 ? 'font-medium tabular-nums text-success' : 'tabular-nums'}>{u.amount > 0 ? '+' : ''}{u.amount}</span> }}
          />
        )}
        {usage.data && usage.data.length > 10 && <div className="mt-3 flex justify-center"><Button size="sm" variant="ghost" onClick={() => setAllUsage((v) => !v)}>{allUsage ? 'Show less' : `Show ${usage.data.length - 10} more`}</Button></div>}
      </section>

      <section id="plans" className="scroll-mt-6">
        <SectionTitle>Plans</SectionTitle>
        {noProviders && <div className="mb-3"><Notice tone="warning">Payments aren't configured on this server yet, so plans can't be purchased.</Notice></div>}
        {catalogue.error ? <ErrorNotice error={catalogue.error} /> : !catalogue.data ? <Skeleton className="h-80" /> : <PlanCards catalogue={catalogue.data} currentCode={o?.plan.code} busyPriceId={busy} onChoose={(price) => start(() => billing.subscribe(price.id), price.id)} />}
      </section>

      {catalogue.data && catalogue.data.creditPacks.length > 0 && (
        <section>
          <SectionTitle>Top up credits</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {catalogue.data.creditPacks.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3">
                <div><div className="font-medium tabular-nums">{p.credits.toLocaleString()} credits</div><div className="text-[13px] text-muted tabular-nums">{money(p.priceMinor, p.currency)} · never expire</div></div>
                <Button size="sm" variant="secondary" disabled={noProviders} loading={busy === p.id} onClick={() => start(() => billing.topup(p.id), p.id)}>Buy</Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Payments & invoices</SectionTitle>
        {!o ? <Skeleton className="h-24" /> : (
          <DataTable
            rows={o.invoices}
            rowKey={(i) => i.id}
            empty={<Card padded={false}><EmptyState compact icon={<Receipt className="size-5" />} title="No payments yet" body="Invoices for subscriptions and top-ups appear here." /></Card>}
            columns={[
              { key: 'n', header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
              { key: 'd', header: 'Description', cell: (i) => i.description },
              { key: 'p', header: 'Date', cell: (i) => <span className="text-muted">{date(i.paidAt)}</span> },
              { key: 's', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
              { key: 't', header: 'Amount', align: 'right', cell: (i) => <span className="tabular-nums">{money(i.totalMinor, i.currency)}{i.refundedMinor > 0 && <span className="block text-xs text-muted">−{money(i.refundedMinor, i.currency)} refunded</span>}</span> },
            ]}
            mobile={{ primary: (i) => i.description, secondary: (i) => `${i.number} · ${date(i.paidAt)}`, trailing: (i) => <span className="tabular-nums">{money(i.totalMinor, i.currency)}</span> }}
          />
        )}
      </section>
    </div>
  );
}

export default function BillingPage() {
  return <Suspense><BillingInner /></Suspense>;
}
