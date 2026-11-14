'use client';

import { CheckCircle2, Clock, PackageCheck, XCircle } from 'lucide-react';
import { use, useEffect, useState } from 'react';
import { Card, Notice, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatMoney, orderToken, shop, type ShopOrder } from '@/lib/shop';

const PAID = new Set(['paid', 'partially_refunded', 'refunded']);

/** Order confirmation for shoppers. Shows "paid" only once the server has the payment provider's confirmation. */
export default function ShopOrderPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params);
  const [order, setOrder] = useState<ShopOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [back, setBack] = useState('/');
  useEffect(() => { try { const b = sessionStorage.getItem(`shop:${slug}:back`); if (b && b.startsWith('/')) setBack(b); } catch { /* ignore */ } }, [slug]);

  useEffect(() => {
    const token = orderToken.get(id);
    if (!token) { setError('Open this page from the browser tab you paid in, or check your email for the receipt.'); return; }
    let stop = false, tries = 0;
    const load = async () => {
      try {
        const o = await shop.order(slug, id, token);
        if (stop) return;
        setOrder(o);
        // Card and UPI confirmations can take a few seconds to arrive from the provider.
        if (o.status === 'pending_payment' && tries++ < 40) setTimeout(load, 3000);
      } catch (e) { if (!stop) setError(e instanceof ApiError && e.status === 404 ? 'Order not found.' : 'Could not load your order. Please refresh.'); }
    };
    void load();
    return () => { stop = true; };
  }, [slug, id]);

  const m = (n: number) => formatMoney(n, order?.currency ?? 'INR');
  const paid = order && PAID.has(order.status);
  const cancelled = order && ['cancelled', 'expired', 'failed'].includes(order.status);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      {error ? <Notice tone="warning">{error}</Notice> : !order ? <Skeleton className="h-72" /> : (
        <Card className="space-y-5">
          <div className="flex items-start gap-3">
            {paid ? <CheckCircle2 className="size-7 shrink-0 text-success" /> : cancelled ? <XCircle className="size-7 shrink-0 text-danger" /> : <Clock className="size-7 shrink-0 text-muted" />}
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.02em]">{paid ? 'Thank you! Your order is confirmed.' : cancelled ? 'This order was not completed.' : 'Waiting for payment confirmation…'}</h1>
              <p className="mt-1 text-sm text-muted">Order #{order.number} · {order.email}</p>
              {!paid && !cancelled && <p className="mt-1 text-sm text-muted">This usually takes a few seconds. You can keep this page open.</p>}
            </div>
          </div>
          <ul className="space-y-2 border-t border-border pt-4 text-sm">
            {order.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-3"><span className="min-w-0 truncate">{i.title}{i.variantTitle && i.variantTitle !== 'Default' ? ` — ${i.variantTitle}` : ''} × {i.quantity}</span><span className="shrink-0 tabular-nums">{m(i.totalMinor)}</span></li>
            ))}
          </ul>
          <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
            {order.discountMinor > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="tabular-nums">−{m(order.discountMinor)}</dd></div>}
            {order.shippingMinor > 0 && <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="tabular-nums">{m(order.shippingMinor)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular-nums">{m(order.taxMinor)}</dd></div>
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(order.totalMinor)}</dd></div>
          </dl>
          {order.trackingNumber && <p className="flex items-center gap-2 text-sm"><PackageCheck className="size-4" />Shipped · tracking {order.trackingNumber}</p>}
          <a href={back} className="inline-block text-sm font-medium underline-offset-4 hover:underline">Continue shopping</a>
        </Card>
      )}
    </main>
  );
}
