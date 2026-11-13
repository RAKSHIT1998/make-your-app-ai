'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, ExternalLink, FileText, RefreshCw, Truck } from 'lucide-react';
import { useState } from 'react';
import { commerce, money, type Extension, type Order, type Shipment, type Store } from '@/lib/api';
import { Badge, Button, Card, cx, Dialog, ErrorNotice, Field, Input, Notice, Skeleton, toast, useConfirm } from './ui';

const CATEGORY = { payments: { label: 'Payments', icon: CreditCard }, delivery: { label: 'Delivery', icon: Truck } } as const;

/** Extensions hub: every service a store can plug in, with its real status. */
export function Extensions({ store, onOpenPayments }: { store: Store; onOpenPayments: () => void }) {
  const list = useQuery({ queryKey: ['extensions', store.id], queryFn: () => commerce.extensions(store.id) });
  const [shiprocket, setShiprocket] = useState(false);
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  const sr = list.data?.find((e) => e.key === 'shiprocket');
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.01em]">Extensions</h2>
        <p className="mt-0.5 text-sm text-muted">Plug your own accounts into the store. Each one is checked when you connect it and your keys are stored encrypted.</p>
      </div>
      {!list.data ? <Skeleton className="h-64" /> : (Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).map((cat) => {
        const Icon = CATEGORY[cat].icon;
        return (
          <section key={cat} aria-label={CATEGORY[cat].label} className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted" />{CATEGORY[cat].label}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {list.data.filter((e) => e.category === cat).map((e) => (
                <Card key={e.key} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{e.name}</span>
                    {e.status === 'connected' ? <Badge tone="success" dot>Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
                  </div>
                  <p className="flex-1 text-sm text-muted">{e.summary}</p>
                  {e.key === 'shiprocket' && e.settings && <p className="truncate text-xs text-subtle">Pickup: {e.settings.pickupLocation} · {e.settings.pickupPostcode}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant={e.status === 'connected' ? 'secondary' : 'primary'} onClick={() => (e.category === 'payments' ? onOpenPayments() : setShiprocket(true))} aria-label={`${e.status === 'connected' ? 'Manage' : 'Connect'} ${e.name}`}>{e.status === 'connected' ? 'Manage' : 'Connect'}</Button>
                    <a href={e.site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">{e.site.replace(/^https:\/\/(www\.)?/, '')}<ExternalLink className="size-3" /></a>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-subtle">Only extensions that are fully built and tested are listed. More are added over time.</p>
      {sr && <ShiprocketDialog store={store} ext={sr} open={shiprocket} onOpenChange={setShiprocket} />}
    </div>
  );
}

function ShiprocketDialog({ store, ext, open, onOpenChange }: { store: Store; ext: Extension; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const s = ext.settings;
  const [f, setF] = useState({ email: s?.email ?? '', password: '', pickupLocation: s?.pickupLocation ?? '', pickupPostcode: s?.pickupPostcode ?? '', weight: String(s?.parcel.weightGrams ?? 500), length: String(s?.parcel.lengthCm ?? 20), breadth: String(s?.parcel.breadthCm ?? 15), height: String(s?.parcel.heightCm ?? 10) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (v: string, min: number, max: number) => /^\d+(\.\d+)?$/.test(v) && Number(v) >= min && Number(v) <= max;
  const connected = ext.status === 'connected';
  const valid = /.+@.+\..+/.test(f.email) && (connected && f.email === s?.email ? true : f.password.length > 0) && f.pickupLocation.trim().length > 0 && /^[1-9][0-9]{5}$/.test(f.pickupPostcode) && num(f.weight, 10, 50000) && num(f.length, 1, 200) && num(f.breadth, 1, 200) && num(f.height, 1, 200);
  const done = (data: Extension[], msg: string) => { qc.setQueryData(['extensions', store.id], data); void qc.invalidateQueries({ queryKey: ['store', store.id] }); toast.success(msg); onOpenChange(false); };
  const save = useMutation({
    mutationFn: () => commerce.connectShiprocket(store.id, { email: f.email.trim(), ...(f.password ? { password: f.password } : {}), pickupLocation: f.pickupLocation.trim(), pickupPostcode: f.pickupPostcode, parcel: { weightGrams: Math.round(Number(f.weight)), lengthCm: Number(f.length), breadthCm: Number(f.breadth), heightCm: Number(f.height) } }),
    onSuccess: (d) => { setF((x) => ({ ...x, password: '' })); done(d, 'Shiprocket verified and connected'); },
  });
  const remove = useMutation({ mutationFn: () => commerce.disconnectShiprocket(store.id), onSuccess: (d) => done(d, 'Shiprocket disconnected'), onError: (e) => toast.error((e as Error).message) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={connected ? 'Shiprocket settings' : 'Connect Shiprocket'} description="Uses your own Shiprocket account. Delivery charges are paid from your Shiprocket wallet.">
      <div className="space-y-4">
        {!connected && (
          <ol className="list-decimal space-y-1 rounded-[var(--radius-md)] bg-surface-muted/70 py-3 pl-8 pr-3 text-[13px] text-muted">
            <li>In Shiprocket, open Settings → API and create an API user. Use that email and password here, not your normal login.</li>
            <li>Add a pickup address in Shiprocket and copy its nickname exactly.</li>
          </ol>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="API user email"><Input type="email" autoComplete="off" spellCheck={false} value={f.email} onChange={set('email')} /></Field>
          <Field label="API user password" hint={connected ? 'Leave empty to keep the saved one' : undefined}><Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
          <Field label="Pickup location name" hint="The nickname saved in Shiprocket"><Input value={f.pickupLocation} onChange={set('pickupLocation')} /></Field>
          <Field label="Pickup PIN code"><Input inputMode="numeric" maxLength={6} value={f.pickupPostcode} onChange={set('pickupPostcode')} /></Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">Usual parcel</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Weight (g)"><Input inputMode="numeric" value={f.weight} onChange={set('weight')} /></Field>
            <Field label="Length (cm)"><Input inputMode="decimal" value={f.length} onChange={set('length')} /></Field>
            <Field label="Width (cm)"><Input inputMode="decimal" value={f.breadth} onChange={set('breadth')} /></Field>
            <Field label="Height (cm)"><Input inputMode="decimal" value={f.height} onChange={set('height')} /></Field>
          </div>
          <p className="mt-1.5 text-xs text-subtle">Used when products have no weight of their own.</p>
        </div>
        {save.error ? <ErrorNotice error={save.error} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate()} disabled={!valid} loading={save.isPending}>{connected ? 'Save' : 'Verify & connect'}</Button>
          {connected && <Button variant="ghost" loading={remove.isPending} onClick={async () => { const r = await confirm({ title: 'Disconnect Shiprocket?', body: 'The saved login is deleted. Parcels already booked are not affected, but you won’t be able to track or cancel them from here.', confirmLabel: 'Disconnect', danger: true }); if (r.ok) remove.mutate(); }}>Disconnect</Button>}
        </div>
      </div>
    </Dialog>
  );
}

const STATE: Record<Shipment['state'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  created: { label: 'Courier not assigned', tone: 'warning' }, awb_assigned: { label: 'Courier assigned', tone: 'info' }, pickup_scheduled: { label: 'Pickup scheduled', tone: 'info' },
  in_transit: { label: 'In transit', tone: 'info' }, out_for_delivery: { label: 'Out for delivery', tone: 'info' }, delivered: { label: 'Delivered', tone: 'success' },
  returned: { label: 'Returned', tone: 'warning' }, cancelled: { label: 'Cancelled', tone: 'neutral' }, exception: { label: 'Delivery problem', tone: 'danger' },
};

/** Delivery for one order: compare couriers, book, track, print the label, cancel. Shown when a delivery extension is connected. */
export function DeliveryPanel({ storeId, order, onChanged }: { storeId: string; order: Order; onChanged: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['shipment', storeId, order.id];
  const ship = useQuery({ queryKey: key, queryFn: () => commerce.shipment(storeId, order.id) });
  const s = ship.data ?? null;
  const active = s && s.state !== 'cancelled';
  const needsCourier = !s || s.state === 'cancelled' || s.state === 'created';
  const [courier, setCourier] = useState<string | null>(null);
  const rates = useQuery({ queryKey: ['rates', storeId, order.id], queryFn: () => commerce.shippingRates(storeId, order.id), enabled: ship.isSuccess && needsCourier, retry: false, staleTime: 60_000 });
  const set = (d: Shipment) => { qc.setQueryData(key, d); onChanged(); };
  const book = useMutation({ mutationFn: () => commerce.bookShipment(storeId, order.id, courier ? { courierId: courier } : {}), onSuccess: (d) => { set(d); if (d.lastError) toast.error(d.lastError); else toast.success('Delivery booked'); }, onError: () => void ship.refetch() });
  const sync = useMutation({ mutationFn: () => commerce.syncShipment(storeId, order.id), onSuccess: set, onError: (e) => toast.error((e as Error).message) });
  const label = useMutation({ mutationFn: () => commerce.shipmentLabel(storeId, order.id), onSuccess: (d) => window.open(d.url, '_blank', 'noopener'), onError: (e) => toast.error((e as Error).message) });
  const cancel = useMutation({ mutationFn: () => commerce.cancelShipment(storeId, order.id), onSuccess: (d) => { set(d); toast.success('Shipment cancelled'); }, onError: (e) => toast.error((e as Error).message) });
  if (ship.isLoading) return <Skeleton className="h-24" />;
  const cheapest = rates.data?.couriers[0];
  const picked = courier ?? cheapest?.courierId ?? null;
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center gap-2"><Truck className="size-4 text-muted" /><span className="font-medium">Delivery</span>{active && <Badge tone={STATE[s.state].tone} dot>{STATE[s.state].label}</Badge>}</div>
      {s?.lastError && <Notice tone="warning">{s.lastError}</Notice>}
      {active && s.awb && (
        <>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5">
            <dt className="text-muted">Courier</dt><dd className="truncate">{s.courierName}</dd>
            <dt className="text-muted">AWB</dt><dd className="truncate font-mono text-[13px]">{s.awb}</dd>
            {s.pickupScheduledFor && <><dt className="text-muted">Pickup</dt><dd>{s.pickupScheduledFor}</dd></>}
            {s.estimatedDelivery && <><dt className="text-muted">Expected</dt><dd>{s.estimatedDelivery}</dd></>}
            {s.providerStatus && <><dt className="text-muted">Latest</dt><dd>{s.providerStatus}</dd></>}
          </dl>
          {s.events.length > 0 && <ul className="space-y-1.5 rounded-[var(--radius-md)] bg-surface-muted/70 p-3 text-[13px]">{s.events.slice(0, 5).map((e, i) => <li key={i} className="flex gap-2"><span className="shrink-0 text-subtle">{e.at.slice(5, 16)}</span><span className="min-w-0">{e.text}{e.location ? ` · ${e.location}` : ''}</span></li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending}><RefreshCw className="size-3.5" />Refresh tracking</Button>
            <Button size="sm" variant="secondary" onClick={() => label.mutate()} loading={label.isPending}><FileText className="size-3.5" />Label</Button>
            {s.trackingUrl && <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 px-2 text-[13px] text-muted hover:text-fg">Tracking page<ExternalLink className="size-3" /></a>}
            {['awb_assigned', 'pickup_scheduled'].includes(s.state) && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={async () => { const r = await confirm({ title: 'Cancel this shipment?', body: 'The courier booking is cancelled in Shiprocket and the order goes back to unfulfilled.', confirmLabel: 'Cancel shipment', danger: true }); if (r.ok) cancel.mutate(); }}>Cancel</Button>}
            {s.state === 'awb_assigned' && <Button size="sm" onClick={() => book.mutate()} loading={book.isPending}>Schedule pickup</Button>}
          </div>
        </>
      )}
      {needsCourier && (
        rates.isLoading ? <Skeleton className="h-20" />
          : rates.error ? <ErrorNotice error={rates.error} onRetry={() => rates.refetch()} />
          : rates.data && rates.data.couriers.length === 0 ? <Notice tone="warning">No courier in your Shiprocket account delivers to this PIN code.</Notice>
          : rates.data ? (
            <>
              <div role="radiogroup" aria-label="Courier" className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                {rates.data.couriers.slice(0, 6).map((c) => (
                  <button key={c.courierId} type="button" role="radio" aria-checked={picked === c.courierId} onClick={() => setCourier(c.courierId)} className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors', picked === c.courierId ? 'bg-surface-muted' : 'hover:bg-surface-muted/50')}>
                    <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-full border', picked === c.courierId ? 'border-primary bg-primary text-primary-fg' : 'border-border')}>{picked === c.courierId && <Check className="size-3" />}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}{c === cheapest && <span className="ml-2 text-xs text-success">Cheapest</span>}</span>
                    <span className="shrink-0 text-xs text-muted">{c.etaDays !== null ? `${c.etaDays} day${c.etaDays === 1 ? '' : 's'}` : ''}</span>
                    <span className="w-16 shrink-0 text-right tabular-nums">{money(c.rateMinor, 'INR')}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-subtle">Rates from Shiprocket for a {(rates.data.weightGrams / 1000).toFixed(2)} kg parcel. The charge comes from your Shiprocket wallet.</p>
              {book.error ? <ErrorNotice error={book.error} /> : null}
              <Button onClick={() => book.mutate()} disabled={!picked} loading={book.isPending}>{s?.state === 'created' ? 'Assign courier' : 'Book delivery'}</Button>
            </>
          ) : null
      )}
    </div>
  );
}
