'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Store as StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorNotice, Input, Skeleton, StatusBadge } from '@/components/ui';
import { commerce } from '@/lib/api';

export default function StoresPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const stores = useQuery({ queryKey: ['stores'], queryFn: commerce.stores });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [gst, setGst] = useState('18');
  const create = useMutation({
    mutationFn: () => commerce.createStore({ name: name.trim(), currency, taxRateBps: Math.round(Number(gst || 0) * 100), pricesIncludeTax: true }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['stores'] });
      router.push(`/stores/${s.id}`);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stores</h1>
          <p className="mt-1 text-sm text-muted">Products, orders, payments and analytics for your online stores.</p>
        </div>
        <Button onClick={() => setOpen((o) => !o)}>New store</Button>
      </div>
      {open && (
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-1.5 sm:col-span-1"><span className="text-sm font-medium">Store name</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kashmir Dry Fruits" /></label>
            <label className="space-y-1.5"><span className="text-sm font-medium">Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-11 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 text-[15px]">
                {['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="space-y-1.5"><span className="text-sm font-medium">Tax rate % (included in prices)</span><Input inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} /></label>
          </div>
          {create.error ? <ErrorNotice error={create.error} /> : null}
          <Button onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>Create store</Button>
        </Card>
      )}
      {stores.error ? <ErrorNotice error={stores.error} /> : !stores.data ? <Skeleton className="h-32" /> : stores.data.length === 0 ? (
        <Card><EmptyState icon={<StoreIcon className="size-5" />} title="No stores yet" body="Create a store to add products, connect Razorpay or Stripe, and take real orders." /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stores.data.map((s) => (
            <Link key={s.id} href={`/stores/${s.id}`}>
              <Card className="h-full p-4 transition-colors hover:border-brand/50">
                <div className="flex items-start justify-between gap-2"><div className="font-medium">{s.name}</div><StatusBadge status={s.status} /></div>
                <div className="mt-1 text-sm text-muted">{s.currency} · {s.paymentProvider ? `${s.paymentProvider} connected` : 'payments not connected'}</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
