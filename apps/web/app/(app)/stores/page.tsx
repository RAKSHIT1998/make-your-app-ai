'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CreditCard, Plus, Store as StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, Input, PageHeader, Select, Skeleton, StatusBadge, toast } from '@/components/ui';
import { commerce } from '@/lib/api';

export default function BusinessStudioPage() {
  const stores = useQuery({ queryKey: ['stores'], queryFn: commerce.stores });
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Studio"
        description="Run your online stores — products, inventory, orders, customers, discounts and payments."
        actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />New store</Button>}
      />
      {stores.error ? <ErrorNotice error={stores.error} onRetry={() => stores.refetch()} /> : !stores.data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-[var(--radius-lg)]" />)}</div>
      ) : stores.data.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={<StoreIcon className="size-5" />} title="No stores yet" body="Create a store to add products, connect Razorpay or Stripe, and take real orders." action={<Button onClick={() => setOpen(true)}>Create a store</Button>} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stores.data.map((s) => (
            <Link key={s.id} href={`/stores/${s.id}`} className="group rounded-[var(--radius-lg)] focus-visible:outline-none">
              <Card interactive className="h-full">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted text-muted"><StoreIcon className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="mt-0.5 truncate font-mono text-xs text-subtle">{s.slug}</div>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
                <div className="mt-4 flex items-center gap-2 text-[13px] text-muted">
                  <CreditCard className="size-3.5" />
                  {s.paymentProvider ? <span className="capitalize">{s.paymentProvider} connected</span> : <span className="text-warning">Payments not connected</span>}
                  <span className="ml-auto">{s.currency}</span>
                  <ChevronRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <NewStoreDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewStoreDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [tax, setTax] = useState('18');
  const taxOk = /^\d{1,2}(\.\d{1,2})?$/.test(tax) && Number(tax) <= 50;
  const create = useMutation({
    mutationFn: () => commerce.createStore({ name: name.trim(), currency, taxRateBps: Math.round(Number(tax || 0) * 100), pricesIncludeTax: true }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['stores'] });
      toast.success(`${s.name} created`);
      router.push(`/stores/${s.id}`);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New store"
      description="You can change these later in the store's settings."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => create.mutate()} disabled={!name.trim() || !taxOk} loading={create.isPending}>Create store</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && taxOk) create.mutate(); }}>
        <Field label="Store name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Kashmir Dry Fruits" maxLength={80} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Currency"><Select value={currency} onChange={(e) => setCurrency(e.target.value)}>{['INR', 'USD', 'EUR', 'GBP', 'AED'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Tax rate (%)" hint="Included in your prices" error={taxOk ? null : 'Enter a rate between 0 and 50'}><Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
        </div>
        {create.error ? <ErrorNotice error={create.error} /> : null}
      </form>
    </Dialog>
  );
}
