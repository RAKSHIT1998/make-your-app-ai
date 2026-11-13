'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Boxes, Check, CircleDashed, CreditCard, LayoutGrid, Megaphone, Puzzle, MoreHorizontal, Package, Percent, Plus, Search, Settings2, ShoppingCart, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { use, useDeferredValue, useState, type ReactNode } from 'react';
import { Badge, Button, Card, cx, Dialog, Drawer, EmptyState, ErrorNotice, Field, Input, Menu, MenuItem, Notice, Segmented, Select, Skeleton, SoonBadge, Stat, StatusBadge, toast, useConfirm } from '@/components/ui';
import { DataTable } from '@/components/ui/table';
import { DeliveryPanel, Extensions } from '@/components/store-extensions';
import { commerce, money, type Order, type Product, type Store } from '@/lib/api';

type Section = 'overview' | 'orders' | 'products' | 'inventory' | 'customers' | 'discounts' | 'marketing' | 'payments' | 'extensions' | 'analytics' | 'settings';
const SECTIONS: { id: Section; label: string; icon: typeof LayoutGrid; soon?: boolean }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'orders', label: 'Orders', icon: ShoppingCart },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'discounts', label: 'Discounts', icon: Percent },
  { id: 'marketing', label: 'Marketing', icon: Megaphone, soon: true },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'extensions', label: 'Extensions', icon: Puzzle },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];
const toMinor = (v: string) => Math.round(Number(v || 0) * 100);
const isAmount = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [section, setSection] = useState<Section>('overview');
  const store = useQuery({ queryKey: ['store', id], queryFn: () => commerce.store(id) });
  if (store.error) return <ErrorNotice error={store.error} onRetry={() => store.refetch()} />;
  const s = store.data;
  const current = SECTIONS.find((x) => x.id === section)!;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/stores" className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-muted hover:text-fg" aria-label="Back to Business Studio"><ArrowLeft className="size-4" /></Link>
        <div className="min-w-0 flex-1">
          {s ? <h1 className="truncate text-xl font-semibold tracking-[-0.02em]">{s.name}</h1> : <Skeleton className="h-7 w-48" />}
          {s && <div className="truncate text-[13px] text-muted">{s.currency} · storefront <span className="font-mono">/storefront/{s.slug}</span></div>}
        </div>
        {s && <StatusBadge status={s.status} />}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Store sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-1 lg:sticky lg:top-6 lg:flex-col">
            {SECTIONS.map(({ id: sid, label, icon: Icon, soon }) => (
              <li key={sid} className="shrink-0">
                <button
                  onClick={() => setSection(sid)}
                  aria-current={section === sid ? 'page' : undefined}
                  className={cx('flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-[var(--radius-md)] px-3 text-sm transition-colors', section === sid ? 'bg-surface-muted font-medium text-fg' : 'text-muted hover:bg-surface-muted/60 hover:text-fg')}
                >
                  <Icon className="size-4 shrink-0" />{label}{soon && <span className="ml-auto pl-2"><SoonBadge /></span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-label={current.label} className="min-w-0">
          {!s ? <Skeleton className="h-64" /> : {
            overview: <Overview store={s} go={setSection} />,
            orders: <Orders store={s} />,
            products: <Products store={s} />,
            inventory: <Inventory store={s} />,
            customers: <Customers store={s} />,
            discounts: <Discounts store={s} />,
            marketing: <Marketing />,
            payments: <Payments store={s} />,
            extensions: <Extensions store={s} onOpenPayments={() => setSection('payments')} />,
            analytics: <Analytics store={s} />,
            settings: <Settings store={s} />,
          }[section]}
        </section>
      </div>
    </div>
  );
}

function SectionHead({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted">{description}</p>}</div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

function SearchInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} className="pl-9" />
    </div>
  );
}

// ───────── Overview ─────────

function Overview({ store, go }: { store: Store; go: (s: Section) => void }) {
  const a = useQuery({ queryKey: ['analytics', store.id, 30], queryFn: () => commerce.analytics(store.id, 30) });
  const products = useQuery({ queryKey: ['products', store.id], queryFn: () => commerce.products(store.id) });
  const orders = useQuery({ queryKey: ['orders', store.id, ''], queryFn: () => commerce.orders(store.id) });
  const setup = [
    { done: !!store.paymentProvider && store.payments?.status === 'connected', label: 'Connect payments', go: 'payments' as const },
    { done: (products.data?.some((p) => p.status === 'active')) ?? false, label: 'Publish a product', go: 'products' as const },
    { done: store.status === 'active', label: 'Set the store live', go: 'settings' as const },
  ];
  const m = (n: number) => money(n, store.currency);
  return (
    <div className="space-y-5">
      <SectionHead title="Overview" description="The last 30 days at a glance." />
      {setup.some((x) => !x.done) && (
        <Card>
          <div className="text-sm font-semibold">Get ready to sell</div>
          <ul className="mt-3 space-y-1">
            {setup.map((x) => (
              <li key={x.label}>
                <button onClick={() => go(x.go)} className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 text-left text-sm hover:bg-surface-muted">
                  {x.done ? <Check className="size-4 text-success" /> : <CircleDashed className="size-4 text-subtle" />}
                  <span className={cx('flex-1', x.done && 'text-muted line-through')}>{x.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a.error ? <ErrorNotice error={a.error} onRetry={() => a.refetch()} /> : !a.data ? <Skeleton className="h-24" /> : (
        <Card className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <Stat label="Net sales" value={m(a.data.netSalesMinor)} />
          <Stat label="Paid orders" value={a.data.orders} />
          <Stat label="Average order" value={m(a.data.averageOrderValueMinor)} />
          <Stat label="Awaiting payment" value={a.data.pendingPaymentOrders} />
        </Card>
      )}
      <Card padded={false}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4"><h3 className="text-sm font-semibold">Recent orders</h3><Button size="xs" variant="ghost" onClick={() => go('orders')}>View all</Button></div>
        {!orders.data ? <div className="p-5"><Skeleton className="h-20" /></div> : orders.data.items.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No orders yet. They appear here as soon as checkout starts.</p> : (
          <ul className="divide-y divide-border border-t border-border">
            {orders.data.items.slice(0, 5).map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="font-medium tabular-nums">#{o.number}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{o.email}</span>
                <span className="tabular-nums">{money(o.totalMinor, o.currency)}</span>
                <StatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ───────── Orders ─────────

const ORDER_FILTERS = [
  { value: '', label: 'All' }, { value: 'paid', label: 'Paid' }, { value: 'pending_payment', label: 'Awaiting payment' },
  { value: 'partially_refunded', label: 'Partially refunded' }, { value: 'refunded', label: 'Refunded' }, { value: 'expired', label: 'Expired' }, { value: 'cancelled', label: 'Cancelled' },
];

function Orders({ store }: { store: Store }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ['orders', store.id, status], queryFn: () => commerce.orders(store.id, status || undefined) });
  const needle = q.trim().toLowerCase();
  const rows = (orders.data?.items ?? []).filter((o) => !needle || o.email.toLowerCase().includes(needle) || String(o.number).includes(needle.replace('#', '')));
  return (
    <div>
      <SectionHead title="Orders" description="Fulfil, track and refund orders from your storefront." />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput label="Search by email or order #" value={q} onChange={setQ} />
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-52">{ORDER_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>
      </div>
      {orders.error ? <ErrorNotice error={orders.error} onRetry={() => orders.refetch()} /> : !orders.data ? <Skeleton className="h-48" /> : (
        <DataTable
          rows={rows}
          rowKey={(o) => o.id}
          onRowClick={(o) => setOpen(o.id)}
          selectedKey={open}
          empty={<Card padded={false}><EmptyState compact icon={<ShoppingCart className="size-5" />} title={orders.data.items.length ? 'No matching orders' : 'No orders yet'} body={orders.data.items.length ? 'Try a different search or status.' : 'Orders placed through your storefront appear here as soon as checkout starts.'} /></Card>}
          columns={[
            { key: 'n', header: 'Order', cell: (o) => <span className="font-medium tabular-nums">#{o.number}</span> },
            { key: 'date', header: 'Date', cell: (o) => <span className="text-muted">{shortDate(o.createdAt)}</span> },
            { key: 'email', header: 'Customer', cell: (o) => <span className="block max-w-[220px] truncate">{o.email}</span> },
            { key: 'status', header: 'Payment', cell: (o) => <StatusBadge status={o.status} /> },
            { key: 'ful', header: 'Fulfilment', cell: (o) => <span className="capitalize text-muted">{o.fulfillmentStatus.replaceAll('_', ' ')}</span> },
            { key: 'total', header: 'Total', align: 'right', cell: (o) => <span className="tabular-nums">{money(o.totalMinor, o.currency)}</span> },
          ]}
          mobile={{ primary: (o) => <>#{o.number} · {o.email}</>, secondary: (o) => `${shortDate(o.createdAt)} · ${o.fulfillmentStatus.replaceAll('_', ' ')}`, trailing: (o) => <div className="flex flex-col items-end gap-1"><span className="tabular-nums">{money(o.totalMinor, o.currency)}</span><StatusBadge status={o.status} /></div> }}
        />
      )}
      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Order details">
        {open && <OrderDetail key={open} storeId={store.id} orderId={open} shipping={!!store.shippingProvider} />}
      </Drawer>
    </div>
  );
}

function OrderDetail({ storeId, orderId, shipping }: { storeId: string; orderId: string; shipping: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const order = useQuery({ queryKey: ['order', storeId, orderId], queryFn: () => commerce.order(storeId, orderId) });
  const [tracking, setTracking] = useState('');
  const [amount, setAmount] = useState('');
  const refresh = () => { for (const k of [['order', storeId, orderId], ['orders', storeId], ['analytics', storeId], ['products', storeId], ['customers', storeId]]) void qc.invalidateQueries({ queryKey: k }); };
  const fulfill = useMutation({ mutationFn: () => commerce.fulfill(storeId, orderId, tracking.trim() || undefined), onSuccess: () => { refresh(); toast.success('Marked as fulfilled'); }, onError: (e) => toast.error((e as Error).message) });
  const refund = useMutation({
    mutationFn: ({ o, minor }: { o: Order; minor: number }) => commerce.refund(storeId, orderId, { amountMinor: minor, reason: 'Refunded from dashboard', restock: minor === o.totalMinor - o.refundedMinor, idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => { setAmount(''); refresh(); toast.success('Refund issued'); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (order.error) return <ErrorNotice error={order.error} />;
  if (!order.data) return <Skeleton className="h-64" />;
  const o = order.data;
  const m = (n: number) => money(n, o.currency);
  const refundable = o.totalMinor - o.refundedMinor;
  const canAct = ['paid', 'partially_refunded'].includes(o.status);
  const minor = isAmount(amount) ? toMinor(amount) : 0;
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center justify-between gap-3"><div className="text-lg font-semibold tabular-nums">#{o.number}</div><StatusBadge status={o.status} /></div>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5">
        <dt className="text-muted">Customer</dt><dd className="truncate">{o.email}</dd>
        <dt className="text-muted">Placed</dt><dd>{new Date(o.createdAt).toLocaleString()}</dd>
        <dt className="text-muted">Fulfilment</dt><dd className="capitalize">{o.fulfillmentStatus.replaceAll('_', ' ')}{o.trackingNumber ? ` · ${o.trackingNumber}` : ''}</dd>
      </dl>
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {o.items.map((i) => <li key={i.id} className="flex justify-between gap-3 px-3 py-2.5"><span className="min-w-0">{i.productTitle} <span className="text-muted">· {i.variantTitle} × {i.quantity}</span></span><span className="shrink-0 tabular-nums">{m(i.totalMinor)}</span></li>)}
      </ul>
      <dl className="space-y-1">
        {([['Subtotal', o.subtotalMinor], ['Discount', -o.discountMinor], ['Shipping', o.shippingMinor], ['Tax (included)', o.taxMinor], ['Refunded', -o.refundedMinor]] as const).filter(([, v]) => v !== 0).map(([k, v]) => <div key={k} className="flex justify-between text-muted"><dt>{k}</dt><dd className="tabular-nums">{m(v)}</dd></div>)}
        <div className="flex justify-between border-t border-border pt-2 font-semibold"><dt>Total</dt><dd className="tabular-nums">{m(o.totalMinor)}</dd></div>
      </dl>
      {shipping && (canAct || o.fulfillmentStatus !== 'unfulfilled') && <DeliveryPanel storeId={storeId} order={o} onChanged={refresh} />}
      {canAct && o.fulfillmentStatus === 'unfulfilled' && (
        <div className="space-y-2 border-t border-border pt-4">
          <div className="font-medium">{shipping ? 'Or fulfil it yourself' : 'Fulfil'}</div>
          <div className="flex gap-2"><Input placeholder="Tracking number (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} /><Button onClick={() => fulfill.mutate()} loading={fulfill.isPending}>Mark fulfilled</Button></div>
        </div>
      )}
      {canAct && refundable > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          <div className="font-medium">Refund</div>
          <div className="flex gap-2">
            <Input inputMode="decimal" aria-label="Refund amount" placeholder={`Up to ${(refundable / 100).toFixed(2)}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button variant="secondary" onClick={() => setAmount((refundable / 100).toFixed(2))}>Full</Button>
            <Button variant="danger" disabled={minor <= 0 || minor > refundable} loading={refund.isPending} onClick={async () => {
              const r = await confirm({ title: `Refund ${m(minor)}?`, body: minor === refundable ? 'This refunds the remaining balance and restocks the items. The money is returned through your payment provider.' : 'This is a partial refund. Items are not restocked. The money is returned through your payment provider.', confirmLabel: 'Issue refund', danger: true });
              if (r.ok) refund.mutate({ o, minor });
            }}>Refund</Button>
          </div>
          {minor > refundable && <p className="text-xs text-danger">That's more than the refundable balance.</p>}
        </div>
      )}
    </div>
  );
}

// ───────── Products & inventory ─────────

function Products({ store }: { store: Store }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const products = useQuery({ queryKey: ['products', store.id], queryFn: () => commerce.products(store.id) });
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['products', store.id] }); void qc.invalidateQueries({ queryKey: ['analytics', store.id] }); };
  const toggle = useMutation({ mutationFn: ({ pid, status }: { pid: string; status: 'active' | 'draft' }) => commerce.updateProduct(store.id, pid, { status }), onSuccess: (_, v) => toast.success(v.status === 'active' ? 'Published' : 'Moved to draft'), onError: (e) => toast.error((e as Error).message), onSettled: refresh });
  const remove = useMutation({ mutationFn: (pid: string) => commerce.deleteProduct(store.id, pid), onSuccess: () => toast.success('Product deleted'), onError: (e) => toast.error((e as Error).message), onSettled: refresh });
  const rows = (products.data ?? []).filter((p) => p.title.toLowerCase().includes(q.toLowerCase()) || p.variants.some((v) => v.sku?.toLowerCase().includes(q.toLowerCase())));
  const price = (p: Product) => { const ps = p.variants.map((v) => v.priceMinor); if (!ps.length) return '—'; const lo = Math.min(...ps), hi = Math.max(...ps); return lo === hi ? money(lo, store.currency) : `${money(lo, store.currency)} – ${money(hi, store.currency)}`; };
  const stock = (p: Product) => p.variants.reduce((n, v) => n + (v.inventory?.tracked ? v.inventory.onHand - v.inventory.reserved : 0), 0);
  return (
    <div>
      <SectionHead title="Products" description="What your storefront sells." actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" />Add product</Button>} />
      <div className="mb-3"><SearchInput label="Search products or SKU" value={q} onChange={setQ} /></div>
      {products.error ? <ErrorNotice error={products.error} onRetry={() => products.refetch()} /> : !products.data ? <Skeleton className="h-48" /> : (
        <DataTable
          rows={rows}
          rowKey={(p) => p.id}
          empty={<Card padded={false}><EmptyState compact icon={<Package className="size-5" />} title={products.data.length ? 'No matching products' : 'No products yet'} body={products.data.length ? 'Try a different search.' : 'Add your first product to start selling.'} action={!products.data.length && <Button onClick={() => setAdding(true)}>Add product</Button>} /></Card>}
          columns={[
            { key: 't', header: 'Product', cell: (p) => <div className="min-w-0"><div className="font-medium">{p.title}</div><div className="font-mono text-xs text-subtle">{p.handle}</div></div> },
            { key: 's', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
            { key: 'v', header: 'Variants', cell: (p) => <span className="text-muted">{p.variants.length}</span> },
            { key: 'st', header: 'Available', align: 'right', cell: (p) => <span className="tabular-nums">{p.digital ? '∞' : stock(p)}</span> },
            { key: 'p', header: 'Price', align: 'right', cell: (p) => <span className="tabular-nums">{price(p)}</span> },
            { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (p) => <ProductMenu p={p} /> },
          ]}
          mobile={{ primary: (p) => p.title, secondary: (p) => `${price(p)} · ${p.digital ? 'digital' : `${stock(p)} available`}`, trailing: (p) => <div className="flex items-center gap-1"><StatusBadge status={p.status} /><ProductMenu p={p} /></div> }}
        />
      )}
      <AddProductDialog store={store} open={adding} onOpenChange={setAdding} />
    </div>
  );

  function ProductMenu({ p }: { p: Product }) {
    return (
      <Menu trigger={<Button size="sm" variant="ghost" iconOnly aria-label={`Actions for ${p.title}`}><MoreHorizontal className="size-4" /></Button>}>
        {p.status !== 'archived' && <MenuItem onSelect={() => toggle.mutate({ pid: p.id, status: p.status === 'active' ? 'draft' : 'active' })}>{p.status === 'active' ? 'Unpublish' : 'Publish'}</MenuItem>}
        <MenuItem danger onSelect={async () => { const r = await confirm({ title: `Delete ${p.title}?`, body: 'It will be removed from your catalogue and storefront. Past orders keep their line items.', confirmLabel: 'Delete', danger: true }); if (r.ok) remove.mutate(p.id); }}><Trash2 className="size-3.5" />Delete</MenuItem>
      </Menu>
    );
  }
}

function AddProductDialog({ store, open, onOpenChange }: { store: Store; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const blank = { title: '', variant: 'Default', price: '', stock: '10', sku: '', active: true };
  const [form, setForm] = useState(blank);
  const valid = form.title.trim() && isAmount(form.price) && /^\d+$/.test(form.stock);
  const create = useMutation({
    mutationFn: () => commerce.createProduct(store.id, { title: form.title.trim(), status: form.active ? 'active' : 'draft', variants: [{ title: form.variant.trim() || 'Default', priceMinor: toMinor(form.price), ...(form.sku.trim() ? { sku: form.sku.trim() } : {}), inventory: { onHand: Number(form.stock) } }] }),
    onSuccess: (p) => { setForm(blank); onOpenChange(false); toast.success(`${p.title} added`); for (const k of ['products', 'analytics']) void qc.invalidateQueries({ queryKey: [k, store.id] }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add product" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => create.mutate()} disabled={!valid} loading={create.isPending}>Add product</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
        <Field label="Title"><Input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Premium Walnuts" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Variant"><Input value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} placeholder="500 g" /></Field>
          <Field label={`Price (${store.currency})`}><Input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="599" /></Field>
          <Field label="Stock"><Input inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>
          <Field label="SKU" hint="Optional"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Publish to storefront now</label>
        {create.error ? <ErrorNotice error={create.error} /> : null}
      </form>
    </Dialog>
  );
}

function Inventory({ store }: { store: Store }) {
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ['products', store.id], queryFn: () => commerce.products(store.id) });
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState<'all' | 'low'>('all');
  const save = useMutation({
    mutationFn: ({ vid, n }: { vid: string; n: number }) => commerce.setStock(store.id, vid, n),
    onSuccess: () => toast.success('Stock updated'),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => { for (const k of ['products', 'analytics']) void qc.invalidateQueries({ queryKey: [k, store.id] }); },
  });
  const rows = (products.data ?? []).flatMap((p) => p.variants.filter((v) => v.inventory?.tracked).map((v) => ({ p, v, inv: v.inventory!, available: v.inventory!.onHand - v.inventory!.reserved })))
    .filter((r) => (`${r.p.title} ${r.v.title} ${r.v.sku ?? ''}`).toLowerCase().includes(q.toLowerCase()) && (lowOnly === 'all' || r.available <= r.inv.lowStockThreshold));
  return (
    <div>
      <SectionHead title="Inventory" description="Stock on hand, reserved by open checkouts, and what's available to sell." />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput label="Search items or SKU" value={q} onChange={setQ} />
        <Segmented label="Show" value={lowOnly} onChange={setLowOnly} options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low stock' }]} />
      </div>
      {products.error ? <ErrorNotice error={products.error} /> : !products.data ? <Skeleton className="h-48" /> : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.v.id}
          empty={<Card padded={false}><EmptyState compact icon={<Boxes className="size-5" />} title={lowOnly === 'low' ? 'Nothing is low on stock' : 'No tracked inventory'} body="Physical products you add are tracked here." /></Card>}
          columns={[
            { key: 'i', header: 'Item', cell: (r) => <div><div className="font-medium">{r.p.title}</div><div className="text-xs text-muted">{r.v.title}{r.v.sku ? ` · ${r.v.sku}` : ''}</div></div> },
            { key: 'h', header: 'On hand', align: 'right', cell: (r) => <span className="tabular-nums">{r.inv.onHand}</span> },
            { key: 'r', header: 'Reserved', align: 'right', cell: (r) => <span className="tabular-nums text-muted">{r.inv.reserved}</span> },
            { key: 'a', header: 'Available', align: 'right', cell: (r) => <span className={cx('tabular-nums font-medium', r.available <= 0 ? 'text-danger' : r.available <= r.inv.lowStockThreshold && 'text-warning')}>{r.available}</span> },
            { key: 'e', header: 'Set on hand', align: 'right', cell: (r) => <StockEditor key={r.inv.onHand} initial={r.inv.onHand} busy={save.isPending && save.variables?.vid === r.v.id} onSave={(n) => save.mutate({ vid: r.v.id, n })} /> },
          ]}
          mobile={{ primary: (r) => `${r.p.title} · ${r.v.title}`, secondary: (r) => `${r.available} available · ${r.inv.reserved} reserved`, trailing: (r) => <StockEditor key={r.inv.onHand} initial={r.inv.onHand} busy={save.isPending && save.variables?.vid === r.v.id} onSave={(n) => save.mutate({ vid: r.v.id, n })} /> }}
        />
      )}
    </div>
  );
}

function StockEditor({ initial, onSave, busy }: { initial: number; onSave: (n: number) => void; busy: boolean }) {
  const [v, setV] = useState(String(initial));
  const dirty = v !== String(initial) && /^\d+$/.test(v);
  return (
    <form className="flex items-center justify-end gap-1.5" onSubmit={(e) => { e.preventDefault(); if (dirty) onSave(Number(v)); }} onClick={(e) => e.stopPropagation()}>
      <Input aria-label="Stock on hand" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-20 text-right tabular-nums" />
      <Button type="submit" size="sm" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty} loading={busy}>Save</Button>
    </form>
  );
}

// ───────── Customers ─────────

function Customers({ store }: { store: Store }) {
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const customers = useQuery({ queryKey: ['customers', store.id, dq], queryFn: () => commerce.customers(store.id, dq), placeholderData: (p) => p });
  const m = (n: number) => money(n, store.currency);
  return (
    <div>
      <SectionHead title="Customers" description="Everyone who has started a checkout in your store." />
      <div className="mb-3"><SearchInput label="Search by name or email" value={q} onChange={setQ} /></div>
      {customers.error ? <ErrorNotice error={customers.error} onRetry={() => customers.refetch()} /> : !customers.data ? <Skeleton className="h-48" /> : (
        <DataTable
          rows={customers.data}
          rowKey={(c) => c.id}
          empty={<Card padded={false}><EmptyState compact icon={<Users className="size-5" />} title={dq ? 'No matching customers' : 'No customers yet'} body={dq ? 'Try a different search.' : 'Customers appear after their first checkout.'} /></Card>}
          columns={[
            { key: 'c', header: 'Customer', cell: (c) => <div className="min-w-0"><div className="font-medium">{c.name ?? c.email}</div>{c.name && <div className="truncate text-xs text-muted">{c.email}</div>}</div> },
            { key: 'o', header: 'Orders', align: 'right', cell: (c) => <span className="tabular-nums">{c.orders}</span> },
            { key: 's', header: 'Spent', align: 'right', cell: (c) => <span className="tabular-nums">{m(c.spentMinor)}</span> },
            { key: 'l', header: 'Last order', cell: (c) => <span className="text-muted">{c.lastOrderAt ? shortDate(c.lastOrderAt) : '—'}</span> },
            { key: 'j', header: 'Since', cell: (c) => <span className="text-muted">{shortDate(c.createdAt)}</span> },
          ]}
          mobile={{ primary: (c) => c.name ?? c.email, secondary: (c) => `${c.orders} order${c.orders === 1 ? '' : 's'}${c.lastOrderAt ? ` · last ${shortDate(c.lastOrderAt)}` : ''}`, trailing: (c) => <span className="tabular-nums">{m(c.spentMinor)}</span> }}
        />
      )}
    </div>
  );
}

// ───────── Discounts ─────────

function Discounts({ store }: { store: Store }) {
  const qc = useQueryClient();
  const discounts = useQuery({ queryKey: ['discounts', store.id], queryFn: () => commerce.discounts(store.id) });
  const [adding, setAdding] = useState(false);
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => commerce.setDiscountActive(store.id, id, active),
    onSuccess: (_, v) => toast.success(v.active ? 'Discount enabled' : 'Discount disabled'),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['discounts', store.id] }),
  });
  const describe = (d: { type: string; value: number }) => d.type === 'percentage' ? `${d.value / 100}% off` : d.type === 'fixed_amount' ? `${money(d.value, store.currency)} off` : 'Free shipping';
  return (
    <div>
      <SectionHead title="Discounts" description="Codes customers can apply at checkout." actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" />New code</Button>} />
      {discounts.error ? <ErrorNotice error={discounts.error} /> : !discounts.data ? <Skeleton className="h-40" /> : (
        <DataTable
          rows={discounts.data}
          rowKey={(d) => d.id}
          empty={<Card padded={false}><EmptyState compact icon={<Percent className="size-5" />} title="No discount codes" body="Create a code like WELCOME10 to reward new customers." action={<Button onClick={() => setAdding(true)}>New code</Button>} /></Card>}
          columns={[
            { key: 'c', header: 'Code', cell: (d) => <span className="font-mono font-medium">{d.code}</span> },
            { key: 'v', header: 'Discount', cell: (d) => describe(d) },
            { key: 'u', header: 'Used', align: 'right', cell: (d) => <span className="tabular-nums">{d.usageCount}{d.usageLimit ? ` / ${d.usageLimit}` : ''}</span> },
            { key: 's', header: 'Status', cell: (d) => <Badge tone={d.active ? 'success' : 'neutral'} dot>{d.active ? 'Active' : 'Disabled'}</Badge> },
            { key: 'a', header: <span className="sr-only">Actions</span>, align: 'right', cell: (d) => <Button size="sm" variant="secondary" loading={toggle.isPending && toggle.variables?.id === d.id} onClick={() => toggle.mutate({ id: d.id, active: !d.active })}>{d.active ? 'Disable' : 'Enable'}</Button> },
          ]}
          mobile={{ primary: (d) => <span className="font-mono">{d.code}</span>, secondary: (d) => `${describe(d)} · used ${d.usageCount}${d.usageLimit ? `/${d.usageLimit}` : ''}`, trailing: (d) => <Button size="sm" variant="secondary" onClick={() => toggle.mutate({ id: d.id, active: !d.active })}>{d.active ? 'Disable' : 'Enable'}</Button> }}
        />
      )}
      <NewDiscountDialog store={store} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function NewDiscountDialog({ store, open, onOpenChange }: { store: Store; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percentage' | 'fixed_amount' | 'free_shipping'>('percentage');
  const [value, setValue] = useState('');
  const [limit, setLimit] = useState('');
  const codeOk = /^[A-Z0-9_-]{3,32}$/.test(code);
  const valueOk = type === 'free_shipping' || (isAmount(value) && Number(value) > 0 && (type !== 'percentage' || Number(value) <= 100));
  const limitOk = limit === '' || /^\d+$/.test(limit);
  const create = useMutation({
    mutationFn: () => commerce.createDiscount(store.id, { code, type, value: type === 'free_shipping' ? 0 : Math.round(Number(value) * 100), ...(limit ? { usageLimit: Number(limit) } : {}) }),
    onSuccess: (d) => { toast.success(`${d.code} created`); setCode(''); setValue(''); setLimit(''); onOpenChange(false); void qc.invalidateQueries({ queryKey: ['discounts', store.id] }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New discount code" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!codeOk || !valueOk || !limitOk} loading={create.isPending} onClick={() => create.mutate()}>Create code</Button></>}>
      <div className="space-y-4">
        <Field label="Code" hint="3–32 letters, numbers, - or _"><Input autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="WELCOME10" className="font-mono" /></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="percentage">Percentage off</option><option value="fixed_amount">Fixed amount off</option><option value="free_shipping">Free shipping</option></Select></Field>
        {type !== 'free_shipping' && <Field label={type === 'percentage' ? 'Percent off' : `Amount off (${store.currency})`}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === 'percentage' ? '10' : '100'} /></Field>}
        <Field label="Usage limit" hint="Optional — leave empty for unlimited redemptions"><Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
        {create.error ? <ErrorNotice error={create.error} /> : null}
      </div>
    </Dialog>
  );
}

function Marketing() {
  return (
    <div>
      <SectionHead title="Marketing" />
      <Card padded={false}><EmptyState icon={<Megaphone className="size-5" />} title="Marketing tools are coming" body="Email campaigns, abandoned-checkout reminders and WhatsApp broadcasts aren't available yet. Discount codes work today." /></Card>
    </div>
  );
}

// ───────── Payments ─────────

function Payments({ store }: { store: Store }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<'razorpay' | 'stripe'>(store.paymentProvider ?? 'razorpay');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const connect = useMutation({
    mutationFn: () => commerce.connectPayments(store.id, { provider, ...creds }),
    onSuccess: () => { setCreds({}); toast.success('Payment provider verified and connected'); void qc.invalidateQueries({ queryKey: ['store', store.id] }); void qc.invalidateQueries({ queryKey: ['stores'] }); },
  });
  const fields = provider === 'razorpay' ? [['keyId', 'Key ID'], ['keySecret', 'Key secret'], ['webhookSecret', 'Webhook secret']] : [['publishableKey', 'Publishable key'], ['secretKey', 'Secret key'], ['webhookSecret', 'Webhook signing secret']];
  const p = store.payments;
  return (
    <div className="space-y-4">
      <SectionHead title="Payments" description="Customers pay you directly through your own Razorpay or Stripe account." />
      <Card>
        {p?.provider ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><span className="font-medium capitalize">{p.provider}</span><StatusBadge status={p.status} />{p.lastTestedAt && <span className="text-xs text-subtle">verified {shortDate(p.lastTestedAt)}</span>}</div>
            {p.webhookUrl && <div><div className="text-muted">Add this webhook URL in your {p.provider} dashboard so payments are confirmed server-side:</div><code className="mt-1.5 block break-all rounded-[var(--radius-sm)] bg-surface-muted p-2.5 font-mono text-xs">{p.webhookUrl}</code></div>}
          </div>
        ) : <Notice tone="warning">Not connected — your store can't take orders until a payment provider is connected.</Notice>}
      </Card>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{p?.provider ? 'Update credentials' : 'Connect a provider'}</h3>
          <Segmented label="Provider" value={provider} onChange={(v) => { setProvider(v); setCreds({}); }} options={[{ value: 'razorpay', label: 'Razorpay' }, { value: 'stripe', label: 'Stripe' }]} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([k, label]) => <Field key={k} label={label!} className={k === 'webhookSecret' ? 'sm:col-span-2' : undefined}><Input type={k!.toLowerCase().includes('secret') ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={creds[k!] ?? ''} onChange={(e) => setCreds({ ...creds, [k!]: e.target.value })} /></Field>)}
        </div>
        <p className="text-xs text-subtle">Keys are verified with {provider === 'razorpay' ? 'Razorpay' : 'Stripe'}, then encrypted at rest. They're never shown again.</p>
        {connect.error ? <ErrorNotice error={connect.error} /> : null}
        <Button onClick={() => connect.mutate()} disabled={fields.some(([k]) => !creds[k!]?.trim())} loading={connect.isPending}>Verify & connect</Button>
      </Card>
    </div>
  );
}

// ───────── Analytics ─────────

function Analytics({ store }: { store: Store }) {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const a = useQuery({ queryKey: ['analytics', store.id, Number(days)], queryFn: () => commerce.analytics(store.id, Number(days)), placeholderData: (p) => p });
  const m = (n: number) => money(n, store.currency);
  return (
    <div className="space-y-4">
      <SectionHead title="Analytics" description="Computed from your paid orders and refunds." actions={<Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />} />
      {a.error ? <ErrorNotice error={a.error} onRetry={() => a.refetch()} /> : !a.data ? <Skeleton className="h-64" /> : (
        <>
          <Card className="grid grid-cols-2 gap-5 lg:grid-cols-3">
            <Stat label="Gross sales" value={m(a.data.grossSalesMinor)} />
            <Stat label="Refunds" value={m(a.data.refundsMinor)} />
            <Stat label="Net sales" value={m(a.data.netSalesMinor)} />
            <Stat label="Paid orders" value={a.data.orders} />
            <Stat label="Average order" value={m(a.data.averageOrderValueMinor)} />
            <Stat label="Awaiting payment" value={a.data.pendingPaymentOrders} />
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Top products</h3>
              {a.data.topProducts.length === 0 ? <p className="text-sm text-muted">No paid orders in this period.</p> : (
                <ul className="space-y-3 text-sm">{a.data.topProducts.map((p) => {
                  const pct = Math.round((p.revenueMinor / Math.max(1, a.data.topProducts[0]!.revenueMinor)) * 100);
                  return <li key={p.productTitle}><div className="flex justify-between gap-3"><span className="truncate">{p.productTitle} <span className="text-muted">× {p.units}</span></span><span className="shrink-0 tabular-nums">{m(p.revenueMinor)}</span></div><div className="mt-1.5 h-1 rounded-full bg-surface-muted"><div className="h-full rounded-full bg-fg/70" style={{ width: `${pct}%` }} /></div></li>;
                })}</ul>
              )}
            </Card>
            <Card>
              <h3 className="mb-3 text-sm font-semibold">Low stock</h3>
              {a.data.lowStock.length === 0 ? <p className="text-sm text-muted">Everything is above its low-stock threshold.</p> : (
                <ul className="space-y-2 text-sm">{a.data.lowStock.map((l) => <li key={l.variantId} className="flex justify-between gap-3"><span className="truncate">{l.productTitle} · {l.variantTitle}</span><span className={cx('shrink-0 font-medium tabular-nums', l.available <= 0 ? 'text-danger' : 'text-warning')}>{l.available} left</span></li>)}</ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ───────── Settings ─────────

function Settings({ store }: { store: Store }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['store', store.id] }); void qc.invalidateQueries({ queryKey: ['stores'] }); };
  const [name, setName] = useState(store.name);
  const [tax, setTax] = useState(String(store.taxRateBps / 100));
  const taxOk = isAmount(tax) && Number(tax) <= 50;
  const update = useMutation({ mutationFn: (b: Parameters<typeof commerce.updateStore>[1]) => commerce.updateStore(store.id, b), onSuccess: () => { refresh(); toast.success('Store updated'); }, onError: (e) => toast.error((e as Error).message) });
  const shipping = useQuery({ queryKey: ['shipping', store.id], queryFn: () => commerce.shipping(store.id) });
  const [ship, setShip] = useState({ name: 'Standard', rate: '', freeOver: '' });
  const shipOk = ship.name.trim() && isAmount(ship.rate) && (ship.freeOver === '' || isAmount(ship.freeOver));
  const addShip = useMutation({
    mutationFn: () => commerce.createShipping(store.id, { name: ship.name.trim(), rateMinor: toMinor(ship.rate), ...(ship.freeOver ? { freeOverMinor: toMinor(ship.freeOver) } : {}) }),
    onSuccess: () => { setShip({ name: 'Standard', rate: '', freeOver: '' }); toast.success('Shipping method added'); void qc.invalidateQueries({ queryKey: ['shipping', store.id] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const setStatus = async (s: Store['status']) => {
    if (s === 'paused') { const r = await confirm({ title: 'Pause this store?', body: 'The storefront stops accepting new orders until you set it live again. Existing orders are unaffected.', confirmLabel: 'Pause store', danger: true }); if (!r.ok) return; }
    update.mutate({ status: s });
  };
  return (
    <div className="space-y-4">
      <SectionHead title="Settings" />
      <Card className="space-y-3">
        <div><h3 className="text-sm font-semibold">Store status</h3><p className="mt-0.5 text-sm text-muted">Only live stores are visible on the storefront.</p></div>
        <Segmented label="Store status" value={store.status} onChange={(s) => void setStatus(s)} options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Live' }, { value: 'paused', label: 'Paused' }]} />
      </Card>
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Details</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Store name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Field label="Tax rate (%)" hint={store.pricesIncludeTax ? 'Included in your prices' : 'Added at checkout'} error={taxOk ? null : 'Enter a rate between 0 and 50'}><Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
        </div>
        <Button variant="secondary" disabled={!name.trim() || !taxOk || (name.trim() === store.name && Math.round(Number(tax) * 100) === store.taxRateBps)} loading={update.isPending && !update.variables?.status} onClick={() => update.mutate({ name: name.trim(), taxRateBps: Math.round(Number(tax) * 100) })}>Save changes</Button>
      </Card>
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Shipping</h3>
        {shipping.data?.length ? (
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border text-sm">{shipping.data.map((s) => <li key={s.id} className="flex justify-between gap-3 px-3 py-2.5"><span>{s.name}</span><span className="text-muted">{money(s.rateMinor, store.currency)}{s.freeOverMinor !== null ? ` · free over ${money(s.freeOverMinor, store.currency)}` : ''}</span></li>)}</ul>
        ) : <p className="text-sm text-muted">No shipping methods yet.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Name"><Input value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} /></Field>
          <Field label={`Rate (${store.currency})`}><Input inputMode="decimal" value={ship.rate} onChange={(e) => setShip({ ...ship, rate: e.target.value })} placeholder="49" /></Field>
          <Field label="Free over" hint="Optional"><Input inputMode="decimal" value={ship.freeOver} onChange={(e) => setShip({ ...ship, freeOver: e.target.value })} placeholder="999" /></Field>
        </div>
        <Button variant="secondary" onClick={() => addShip.mutate()} disabled={!shipOk} loading={addShip.isPending}>Add shipping method</Button>
      </Card>
    </div>
  );
}
