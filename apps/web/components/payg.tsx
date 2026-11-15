'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Sparkles } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNotice, Field, Input, Meter, Notice, Select, Skeleton, Toggle, toast, useConfirm } from '@/components/ui';
import { billing, money, type PaygView } from '@/lib/api';
import { openCheckout } from '@/lib/checkout';

const STATUS: Record<PaygView['status'], { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  none: { label: 'Off', tone: 'neutral' },
  pending: { label: 'Waiting for card', tone: 'warning' },
  active: { label: 'On', tone: 'success' },
  past_due: { label: 'Payment failed', tone: 'danger' },
  disabled: { label: 'Switched off', tone: 'neutral' },
};
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Pay-as-you-go: save a card to unlock Premium AI and keep building past your credits, up to a monthly cap you set.
 * The card is saved on the provider's own page; nothing here turns anything on — only the provider's signed webhook does.
 */
export function PayAsYouGo() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const params = useSearchParams();
  const [waiting, setWaiting] = useState(params.get('payg') === 'saved');
  const q = useQuery({ queryKey: ['payg'], queryFn: billing.payg, refetchInterval: (x) => (waiting && x.state.data?.status !== 'active' ? 3000 : false) });
  const p = q.data;
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [cap, setCap] = useState('');
  useEffect(() => {
    if (!p) return;
    const first = p.currency ?? p.currencies.find((c) => c.available)?.currency ?? 'INR';
    setCurrency(first);
    if (p.monthlyCapMinor) setCap(String(p.monthlyCapMinor / 100));
    else setCap(first === 'INR' ? '2000' : '20');
  }, [p?.currency, p?.monthlyCapMinor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (waiting && p?.status === 'active') {
      setWaiting(false);
      for (const k of ['billing', 'estimate', 'credits']) void qc.invalidateQueries({ queryKey: [k] });
      toast.success('Card saved — pay-as-you-go and Premium AI are unlocked');
    }
  }, [waiting, p?.status, qc]);

  const refresh = (v?: PaygView) => {
    if (v) qc.setQueryData(['payg'], v);
    for (const k of ['payg', 'billing', 'estimate']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const capMinor = Math.round(Number(cap) * 100);
  const cur = p?.currencies.find((c) => c.currency === currency);
  const capError = !cap || !Number.isFinite(capMinor) ? 'Enter a monthly cap' : cur && (capMinor < cur.minCapMinor || capMinor > cur.maxCapMinor) ? `Between ${money(cur.minCapMinor, currency)} and ${money(cur.maxCapMinor, currency)}` : null;

  const setup = useMutation({
    mutationFn: () => billing.paygSetup(currency, capMinor),
    onSuccess: async (params) => {
      setWaiting(true);
      void qc.invalidateQueries({ queryKey: ['payg'] });
      await openCheckout(params, () => undefined, () => toast.message('Card check done. Waiting for your bank to confirm the card for automatic payments.'));
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const settings = useMutation({ mutationFn: billing.paygSettings, onSuccess: (v) => { refresh(v); toast.success('Saved'); }, onError: (e) => { void qc.invalidateQueries({ queryKey: ['payg'] }); toast.error((e as Error).message); } });
  const disable = useMutation({ mutationFn: billing.paygDisable, onSuccess: (v) => { refresh(v); toast.success('Pay-as-you-go switched off'); }, onError: (e) => toast.error((e as Error).message) });
  const enable = useMutation({ mutationFn: billing.paygEnable, onSuccess: (v) => { refresh(v); toast.success('Pay-as-you-go is back on'); }, onError: (e) => toast.error((e as Error).message) });
  const pay = useMutation({ mutationFn: billing.paygPay, onSuccess: (v) => { refresh(v); toast.success('Payment started. It updates here once your card provider confirms it.'); }, onError: (e) => toast.error((e as Error).message) });

  // The switch answers at once; the server's value takes over again once the save settles.
  const [premium, setPremium] = useState(false);
  useEffect(() => { if (p && !settings.isPending) setPremium(p.premiumAi); }, [p?.premiumAi, settings.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.error) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  if (!p) return <Skeleton className="h-56" />;
  const st = STATUS[p.status];
  const rateText = (r: { credits: number; priceMinor: number } | null, c: string) => (r ? `${money(Math.round((r.priceMinor * 100) / r.credits), c)} per 100 credits` : 'not priced yet');
  const anyAvailable = p.currencies.some((c) => c.available);

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent"><Sparkles className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Premium AI and no hard stop</span><Badge tone={st.tone}>{st.label}</Badge></div>
          <p className="mt-0.5 text-[13px] text-muted">Save a card to unlock <span className="font-medium text-fg">Premium AI</span> (our strongest models) and keep building after your credits run out. You set a monthly cap; we never charge above it.</p>
        </div>
      </div>

      {!p.enabled && p.status === 'none' && <Notice tone="warning">Pay-as-you-go is temporarily unavailable.</Notice>}
      {p.lastError && <Notice tone={p.status === 'past_due' ? 'danger' : 'warning'}>{p.lastError}</Notice>}

      {p.status === 'past_due' && (
        <Notice tone="danger" action={<Button size="sm" loading={pay.isPending} onClick={() => pay.mutate()}>Pay now</Button>}>
          Pay-as-you-go and Premium AI are paused until this is paid: {money(p.owedMinor, p.currency ?? 'INR')} outstanding.
        </Notice>
      )}

      {(p.status === 'active' || p.status === 'past_due' || p.status === 'disabled') && p.currency ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Meter label={`This month (cap ${money(p.monthlyCapMinor, p.currency)})`} value={p.usedThisMonth} max={Math.max(1, p.capCredits)} />
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between"><dt className="text-muted">Card</dt><dd className="flex items-center gap-1.5 font-medium"><CreditCard className="size-3.5 text-subtle" />{p.cardLabel ?? 'Saved card'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Price</dt><dd className="font-medium tabular-nums">{rateText(p.rate, p.currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Not yet charged</dt><dd className="font-medium tabular-nums">{p.owedCredits.toLocaleString()} credits · {money(p.owedMinor, p.currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Left this month</dt><dd className="font-medium tabular-nums">{p.headroom.toLocaleString()} credits</dd></div>
              </dl>
              <p className="text-xs text-subtle">Charged when unpaid usage reaches {p.chargesAt ? money(p.chargesAt, p.currency) : 'the threshold'}, or at the start of next month. {p.provider === 'razorpay' && 'Your bank sends a notice before each debit, and the debit lands about a day and a half later.'}</p>
            </div>
            <div className="space-y-4">
              <Toggle
                checked={premium}
                disabled={!p.premiumAvailable}
                onChange={(v) => { setPremium(v); settings.mutate({ premiumAi: v }); }}
                label="Premium AI for builds"
                hint="Planning, design and code use our strongest models. Better results, more credits per build."
              />
              <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!capError) settings.mutate({ monthlyCapMinor: capMinor }); }}>
                <Field label={`Monthly cap (${p.currency})`} error={cap && capError ? capError : null} className="flex-1">
                  <Input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))} />
                </Field>
                <Button type="submit" size="sm" variant="secondary" loading={settings.isPending} disabled={!!capError || capMinor === p.monthlyCapMinor}>Save cap</Button>
              </form>
              <div className="flex flex-wrap gap-2">
                {p.status === 'disabled' ? <Button size="sm" loading={enable.isPending} onClick={() => enable.mutate()}>Switch back on</Button> : (
                  <Button size="sm" variant="ghost" className="text-danger" loading={disable.isPending} onClick={async () => {
                    const r = await confirm({ title: 'Switch off pay-as-you-go?', body: `Builds stop when your credits run out and Premium AI turns off. Usage already made (${money(p.owedMinor, p.currency!)}) is still charged to your card.`, confirmLabel: 'Switch off', danger: true });
                    if (r.ok) disable.mutate();
                  }}>Switch off</Button>
                )}
                <Button size="sm" variant="ghost" loading={setup.isPending} disabled={!p.enabled} onClick={() => setup.mutate()}>Change card</Button>
                {p.owedMinor > 0 && p.status !== 'past_due' && <Button size="sm" variant="ghost" loading={pay.isPending} onClick={() => pay.mutate()}>Pay {money(p.owedMinor, p.currency)} now</Button>}
              </div>
            </div>
          </div>
          {p.charges.length > 0 && (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border text-[13px]">
              {p.charges.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-muted">{date(c.createdAt)}</span>
                  <span className="flex-1 truncate">{c.credits.toLocaleString()} credits{c.error && <span className="block truncate text-xs text-danger">{c.error}</span>}</span>
                  <Badge tone={c.status === 'paid' ? 'success' : c.status === 'failed' ? 'danger' : 'warning'}>{c.status === 'pending' ? 'Processing' : c.status === 'paid' ? 'Paid' : 'Failed'}</Badge>
                  <span className="tabular-nums">{money(c.amountMinor, c.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[160px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (!capError) setup.mutate(); }}>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => { const c = e.target.value as 'INR' | 'USD'; setCurrency(c); setCap(c === 'INR' ? '2000' : '20'); }}>
              {p.currencies.map((c) => <option key={c.currency} value={c.currency} disabled={!c.available}>{c.currency}{c.available ? '' : ' (not available)'}</option>)}
            </Select>
          </Field>
          <Field label="Monthly cap" error={cap && capError ? capError : null} hint={cur?.rate ? `${rateText(cur.rate, currency)} · the same price as a top-up` : undefined}>
            <Input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Button type="submit" loading={setup.isPending || (waiting && p.status === 'pending')} disabled={!p.enabled || !anyAvailable || !cur?.available || !!capError}>{p.status === 'pending' ? 'Try again' : 'Add card'}</Button>
          <p className="text-xs text-subtle sm:col-span-3">
            {currency === 'INR' ? 'Razorpay saves your card for automatic payments with a ₹1 card check. Indian rules cap each automatic debit at ₹15,000.' : 'Stripe saves your card on its own page; nothing is charged now.'} Usage is charged only after your plan and top-up credits are used up. Switch it off any time.
          </p>
          {waiting && p.status === 'pending' && <div className="sm:col-span-3"><Notice tone="info">Waiting for {currency === 'INR' ? 'your bank' : 'Stripe'} to confirm the card. This updates automatically.</Notice></div>}
          {!anyAvailable && <div className="sm:col-span-3"><Notice tone="warning">Card payments aren't set up on this server yet.</Notice></div>}
        </form>
      )}
    </Card>
  );
}
