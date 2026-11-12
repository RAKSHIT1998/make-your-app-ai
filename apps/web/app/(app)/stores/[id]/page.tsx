'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, Package, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { Button, Card, EmptyState, ErrorNotice, Input, Skeleton, StatusBadge } from '@/components/ui';
import { commerce, money, type Order, type Store } from '@/lib/api';

type Tab = 'overview' | 'products' | 'orders' | 'settings';
const toMinor = (v: string) => Math.round(Number(v || 0) * 100);

export default function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>('overview');
  const store = useQuery({ queryKey: ['store', id], queryFn: () => commerce.store(id) });
  if (store.error) return <ErrorNotice error={store.error} />;
  const s = store.data;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/stores" className="rounded-[var(--radius-md)] p-1.5 text-muted hover:bg-surface-muted" aria-label="Back to stores"><ArrowLeft className="size-4" /></Link>
        <div className="min-w-0 flex-1">
          {s ? <h1 className="truncate text-xl font-semibold tracking-tight">{s.name}</h1> : <Skeleton className="h-7 w-48" />}
          {s && <div className="text-sm text-muted">Storefront API: <span className="font-mono">/api/v1/storefront/{s.slug}</span></div>}
        </div>
        {s && <StatusBadge status={s.status} />}
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface p-1" role="tablist">
        {(['overview', 'products', 'orders', 'settings'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium capitalize', tab === t ? 'bg-brand-soft text-brand' : 'text-muted hover:text-fg')}>{t}</button>
        ))}
      </div>
      {!s ? <Skeleton className="h-64" /> : tab === 'overview' ? <Overview store={s} /> : tab === 'products' ? <Products store={s} /> : tab === 'orders' ? <Orders store={s} /> : <Settings store={s} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </Card>
  );
}

function Overview({ store }: { store: Store }) {
  const a = useQuery({ queryKey: ['analytics', store.id], queryFn: () => commerce.analytics(store.id, 30) });
  if (a.error) return <ErrorNotice error={a.error} />;
  if (!a.data) return <Skeleton className="h-40" />;
  const m = (n: number) => money(n, a.data.currency);
  return (
    <div className="space-y-5">
      {!store.paymentProvider && <div className="rounded-[var(--radius-md)] border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">Connect Razorpay or Stripe in Settings before your store can take orders.</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net sales · 30 days" value={m(a.data.netSalesMinor)} />
        <Stat label="Orders" value={String(a.data.orders)} />
        <Stat label="Average order value" value={m(a.data.averageOrderValueMinor)} />
        <Stat label="Awaiting payment" value={String(a.data.pendingPaymentOrders)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Top products</h3>
          {a.data.topProducts.length === 0 ? <p className="text-sm text-muted">No paid orders yet.</p> : (
            <ul className="space-y-2 text-sm">{a.data.topProducts.map((p) => <li key={p.productTitle} className="flex justify-between"><span>{p.productTitle} <span className="text-muted">× {p.units}</span></span><span className="font-medium">{m(p.revenueMinor)}</span></li>)}</ul>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Low stock</h3>
          {a.data.lowStock.length === 0 ? <p className="text-sm text-muted">Everything is above its low-stock threshold.</p> : (
            <ul className="space-y-2 text-sm">{a.data.lowStock.map((l) => <li key={l.variantId} className="flex justify-between"><span>{l.productTitle} — {l.variantTitle}</span><span className={clsx('font-medium', l.available <= 0 ? 'text-danger' : 'text-warning')}>{l.available} left</span></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Products({ store }: { store: Store }) {
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ['products', store.id], queryFn: () => commerce.products(store.id) });
  const [form, setForm] = useState({ title: '', variant: 'Default', price: '', stock: '10', sku: '', active: true });
  const create = useMutation({
    mutationFn: () => commerce.createProduct(store.id, { title: form.title.trim(), status: form.active ? 'active' : 'draft', variants: [{ title: form.variant.trim() || 'Default', priceMinor: toMinor(form.price), ...(form.sku.trim() ? { sku: form.sku.trim() } : {}), inventory: { onHand: Number(form.stock || 0) } }] }),
    onSuccess: () => {
      setForm({ title: '', variant: 'Default', price: '', stock: '10', sku: '', active: true });
      void qc.invalidateQueries({ queryKey: ['products', store.id] });
    },
  });
  const stock = useMutation({
    mutationFn: ({ vid, n }: { vid: string; n: number }) => commerce.setStock(store.id, vid, n),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['products', store.id] }),
  });
  const toggle = useMutation({
    mutationFn: ({ pid, status }: { pid: string; status: 'active' | 'draft' }) => commerce.updateProduct(store.id, pid, { status }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['products', store.id] }),
  });
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Add product</h3>
        <div className="grid gap-3 md:grid-cols-6">
          <label className="space-y-1 md:col-span-2"><span className="text-sm font-medium">Title</span><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Premium Walnuts" /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Variant</span><Input value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} placeholder="500 g" /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Price ({store.currency})</span><Input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="599" /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Stock</span><Input inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">SKU</span><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="optional" /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Publish to storefront</label>
        {create.error ? <ErrorNotice error={create.error} /> : null}
        <Button onClick={() => create.mutate()} disabled={!form.title.trim() || !form.price} loading={create.isPending}>Add product</Button>
      </Card>
      {stock.error ? <ErrorNotice error={stock.error} /> : null}
      {!products.data ? <Skeleton className="h-40" /> : products.data.length === 0 ? (
        <Card><EmptyState icon={<Package className="size-5" />} title="No products yet" body="Add your first product above." /></Card>
      ) : (
        <Card className="divide-y divide-border">
          {products.data.map((p) => (
            <div key={p.id} className="space-y-2 p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1"><div className="font-medium">{p.title}</div><div className="font-mono text-xs text-subtle">{p.handle}</div></div>
                <StatusBadge status={p.status} />
                <Button size="sm" variant="secondary" onClick={() => toggle.mutate({ pid: p.id, status: p.status === 'active' ? 'draft' : 'active' })}>{p.status === 'active' ? 'Unpublish' : 'Publish'}</Button>
              </div>
              {p.variants.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-sm">
                  <span className="min-w-24 font-medium">{v.title}</span>
                  <span>{money(v.priceMinor, store.currency)}</span>
                  {v.sku && <span className="font-mono text-xs text-muted">{v.sku}</span>}
                  {v.inventory?.tracked && (
                    <span className="ml-auto flex items-center gap-2 text-muted">
                      {v.inventory.onHand} in stock{v.inventory.reserved ? ` · ${v.inventory.reserved} reserved` : ''}
                      <StockEditor initial={v.inventory.onHand} onSave={(n) => stock.mutate({ vid: v.id, n })} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function StockEditor({ initial, onSave }: { initial: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(initial));
  return (
    <span className="flex items-center gap-1">
      <input aria-label="Set stock" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-16 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-sm" />
      <Button size="sm" variant="ghost" onClick={() => onSave(Number(v))} disabled={v === String(initial) || !/^\d+$/.test(v)}>Save</Button>
    </span>
  );
}

function Orders({ store }: { store: Store }) {
  const orders = useQuery({ queryKey: ['orders', store.id], queryFn: () => commerce.orders(store.id) });
  const [open, setOpen] = useState<string | null>(null);
  if (orders.error) return <ErrorNotice error={orders.error} />;
  if (!orders.data) return <Skeleton className="h-40" />;
  if (orders.data.items.length === 0) return <Card><EmptyState icon={<ShoppingCart className="size-5" />} title="No orders yet" body="Orders placed through your storefront appear here as soon as checkout starts." /></Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="divide-y divide-border">
        {orders.data.items.map((o) => (
          <button key={o.id} onClick={() => setOpen(o.id)} className={clsx('flex w-full items-center gap-3 p-4 text-left text-sm hover:bg-surface-muted', open === o.id && 'bg-brand-soft/50')}>
            <span className="font-semibold">#{o.number}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{o.email}</span>
            <span className="font-medium">{money(o.totalMinor, o.currency)}</span>
            <StatusBadge status={o.status} />
          </button>
        ))}
      </Card>
      {open ? <OrderDetail key={open} storeId={store.id} orderId={open} /> : <Card className="p-6 text-sm text-muted">Select an order to see details.</Card>}
    </div>
  );
}

function OrderDetail({ storeId, orderId }: { storeId: string; orderId: string }) {
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['order', storeId, orderId], queryFn: () => commerce.order(storeId, orderId) });
  const [tracking, setTracking] = useState('');
  const [amount, setAmount] = useState('');
  const refresh = () => {
    for (const k of [['order', storeId, orderId], ['orders', storeId], ['analytics', storeId], ['products', storeId]]) void qc.invalidateQueries({ queryKey: k });
  };
  const fulfill = useMutation({ mutationFn: () => commerce.fulfill(storeId, orderId, tracking.trim() || undefined), onSuccess: refresh });
  const refund = useMutation({ mutationFn: (o: Order) => commerce.refund(storeId, orderId, { amountMinor: toMinor(amount), reason: 'Refunded from dashboard', restock: toMinor(amount) === o.totalMinor - o.refundedMinor, idempotencyKey: crypto.randomUUID() }), onSuccess: () => { setAmount(''); refresh(); } });
  if (!order.data) return <Skeleton className="h-64" />;
  const o = order.data;
  const m = (n: number) => money(n, o.currency);
  const canRefund = ['paid', 'partially_refunded'].includes(o.status);
  return (
    <Card className="space-y-4 p-5 text-sm">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Order #{o.number}</h3><StatusBadge status={o.status} /></div>
      <div className="text-muted">{o.email} · {new Date(o.createdAt).toLocaleString()} · {o.fulfillmentStatus}{o.trackingNumber ? ` · ${o.trackingNumber}` : ''}</div>
      <ul className="space-y-1">{o.items.map((i) => <li key={i.id} className="flex justify-between"><span>{i.productTitle} — {i.variantTitle} × {i.quantity}</span><span>{m(i.totalMinor)}</span></li>)}</ul>
      <dl className="space-y-1 border-t border-border pt-3">
        {([['Subtotal', o.subtotalMinor], ['Discount', -o.discountMinor], ['Shipping', o.shippingMinor], ['Tax (incl.)', o.taxMinor], ['Refunded', -o.refundedMinor]] as const).filter(([, v]) => v !== 0).map(([k, v]) => <div key={k} className="flex justify-between text-muted"><dt>{k}</dt><dd>{m(v)}</dd></div>)}
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{m(o.totalMinor)}</dd></div>
      </dl>
      {(fulfill.error || refund.error) ? <ErrorNotice error={fulfill.error ?? refund.error} /> : null}
      {canRefund && o.fulfillmentStatus === 'unfulfilled' && (
        <div className="flex gap-2"><Input placeholder="Tracking number (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} /><Button onClick={() => fulfill.mutate()} loading={fulfill.isPending}>Mark fulfilled</Button></div>
      )}
      {canRefund && (
        <div className="flex gap-2">
          <Input inputMode="decimal" placeholder={`Refund amount (max ${((o.totalMinor - o.refundedMinor) / 100).toFixed(2)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button variant="danger" onClick={() => refund.mutate(o)} disabled={!amount || toMinor(amount) <= 0} loading={refund.isPending}>Refund</Button>
        </div>
      )}
    </Card>
  );
}

function Settings({ store }: { store: Store }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['store', store.id] });
  const status = useMutation({ mutationFn: (s: Store['status']) => commerce.updateStore(store.id, { status: s }), onSuccess: refresh });
  const [provider, setProvider] = useState<'razorpay' | 'stripe'>(store.paymentProvider ?? 'razorpay');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const connect = useMutation({ mutationFn: () => commerce.connectPayments(store.id, { provider, ...creds }), onSuccess: () => { setCreds({}); refresh(); } });
  const shipping = useQuery({ queryKey: ['shipping', store.id], queryFn: () => commerce.shipping(store.id) });
  const discounts = useQuery({ queryKey: ['discounts', store.id], queryFn: () => commerce.discounts(store.id) });
  const [ship, setShip] = useState({ name: 'Standard', rate: '', freeOver: '' });
  const addShip = useMutation({ mutationFn: () => commerce.createShipping(store.id, { name: ship.name, rateMinor: toMinor(ship.rate), ...(ship.freeOver ? { freeOverMinor: toMinor(ship.freeOver) } : {}) }), onSuccess: () => { setShip({ name: 'Standard', rate: '', freeOver: '' }); void qc.invalidateQueries({ queryKey: ['shipping', store.id] }); } });
  const [disc, setDisc] = useState({ code: '', percent: '' });
  const addDisc = useMutation({ mutationFn: () => commerce.createDiscount(store.id, { code: disc.code, type: 'percentage', value: Math.round(Number(disc.percent) * 100) }), onSuccess: () => { setDisc({ code: '', percent: '' }); void qc.invalidateQueries({ queryKey: ['discounts', store.id] }); } });
  const fields = provider === 'razorpay' ? [['keyId', 'Key ID'], ['keySecret', 'Key secret'], ['webhookSecret', 'Webhook secret']] : [['publishableKey', 'Publishable key'], ['secretKey', 'Secret key'], ['webhookSecret', 'Webhook signing secret']];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h3 className="font-semibold">Store status</h3>
        <p className="text-sm text-muted">Only active stores are visible on the storefront API.</p>
        <div className="flex gap-2">{(['draft', 'active', 'paused'] as const).map((s) => <Button key={s} size="sm" variant={store.status === s ? 'primary' : 'secondary'} onClick={() => status.mutate(s)} disabled={store.status === s}>{s}</Button>)}</div>
        {status.error ? <ErrorNotice error={status.error} /> : null}
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="font-semibold">Payments</h3>
        {store.payments?.provider ? (
          <div className="space-y-1 text-sm"><div><span className="font-medium capitalize">{store.payments.provider}</span> · <span className={store.payments.status === 'connected' ? 'text-success' : 'text-warning'}>{store.payments.status}</span></div><div className="text-muted">Webhook URL (add this in your {store.payments.provider} dashboard):</div><code className="block break-all rounded-[var(--radius-sm)] bg-surface-muted p-2 text-xs">{store.payments.webhookUrl}</code></div>
        ) : <p className="text-sm text-warning">Setup required — connect a payment provider to accept orders.</p>}
        <div className="flex gap-2">{(['razorpay', 'stripe'] as const).map((p) => <Button key={p} size="sm" variant={provider === p ? 'primary' : 'secondary'} onClick={() => setProvider(p)}>{p === 'razorpay' ? 'Razorpay' : 'Stripe'}</Button>)}</div>
        {fields.map(([k, label]) => <label key={k} className="block space-y-1"><span className="text-sm font-medium">{label}</span><Input type={k.toLowerCase().includes('secret') ? 'password' : 'text'} autoComplete="off" value={creds[k!] ?? ''} onChange={(e) => setCreds({ ...creds, [k!]: e.target.value })} /></label>)}
        {connect.error ? <ErrorNotice error={connect.error} /> : null}
        <Button onClick={() => connect.mutate()} disabled={fields.some(([k]) => !creds[k!])} loading={connect.isPending}>Test & connect</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="font-semibold">Shipping</h3>
        <ul className="space-y-1 text-sm">{shipping.data?.map((s) => <li key={s.id} className="flex justify-between"><span>{s.name}</span><span className="text-muted">{money(s.rateMinor, store.currency)}{s.freeOverMinor !== null ? ` · free over ${money(s.freeOverMinor, store.currency)}` : ''}</span></li>)}</ul>
        <div className="grid grid-cols-3 gap-2"><Input aria-label="Shipping name" value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} /><Input aria-label="Rate" placeholder="Rate" inputMode="decimal" value={ship.rate} onChange={(e) => setShip({ ...ship, rate: e.target.value })} /><Input aria-label="Free over" placeholder="Free over" inputMode="decimal" value={ship.freeOver} onChange={(e) => setShip({ ...ship, freeOver: e.target.value })} /></div>
        {addShip.error ? <ErrorNotice error={addShip.error} /> : null}
        <Button size="sm" variant="secondary" onClick={() => addShip.mutate()} disabled={!ship.name || ship.rate === ''}>Add shipping method</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="font-semibold">Discount codes</h3>
        <ul className="space-y-1 text-sm">{discounts.data?.map((d) => <li key={d.id} className="flex justify-between"><span className="font-mono">{d.code}</span><span className="text-muted">{d.type === 'percentage' ? `${d.value / 100}% off` : d.type} · used {d.usageCount}{d.usageLimit ? `/${d.usageLimit}` : ''}</span></li>)}</ul>
        <div className="grid grid-cols-2 gap-2"><Input aria-label="Code" placeholder="WELCOME10" value={disc.code} onChange={(e) => setDisc({ ...disc, code: e.target.value.toUpperCase() })} /><Input aria-label="Percent off" placeholder="% off" inputMode="decimal" value={disc.percent} onChange={(e) => setDisc({ ...disc, percent: e.target.value })} /></div>
        {addDisc.error ? <ErrorNotice error={addDisc.error} /> : null}
        <Button size="sm" variant="secondary" onClick={() => addDisc.mutate()} disabled={disc.code.length < 3 || !disc.percent}>Add discount</Button>
      </Card>
    </div>
  );
}
