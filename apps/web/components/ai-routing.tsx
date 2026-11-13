'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { admin, type AiRoute, type AiRouteInput, type AiTier } from '@/lib/api';
import { Badge, Button, Card, Dialog, ErrorNotice, Field, Input, Menu, MenuItem, Segmented, Skeleton, Stat, toast, useConfirm } from './ui';
import { DataTable } from './ui/table';

const TIERS: { tier: AiTier; label: string; blurb: string }[] = [
  { tier: 'fast', label: 'Fast', blurb: 'Design systems, small steps' },
  { tier: 'balanced', label: 'Balanced', blurb: 'Planning and writing code' },
  { tier: 'deep', label: 'Deep', blurb: 'Hard reasoning' },
];
const usd = (micros: number) => (micros / 1e6).toString();
const toMicros = (v: string) => Math.round(Number(v) * 1e6);
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
const EMPTY: AiRouteInput = { provider: '', model: '', tier: 'balanced', priority: 100, enabled: true, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0, quality: 80, dailyRequestLimit: null, dailyTokenLimit: null };

function envName(provider: string) {
  return provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : `${provider.toUpperCase()}_API_KEY`;
}

export function AiRoutingPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin-ai-routing'], queryFn: admin.aiRouting, refetchInterval: 30_000 });
  const [edit, setEdit] = useState<AiRouteInput | null>(null);
  const done = (msg: string) => () => { toast.success(msg); void qc.invalidateQueries({ queryKey: ['admin-ai-routing'] }); setEdit(null); };
  const save = useMutation({ mutationFn: admin.saveRoute, onSuccess: done('Route saved. It applies immediately.'), onError: (e) => toast.error((e as Error).message) });
  const del = useMutation({ mutationFn: admin.deleteRoute, onSuccess: done('Route removed'), onError: (e) => toast.error((e as Error).message) });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const d = q.data;

  const status = (r: AiRoute) => !r.enabled ? <Badge>Off</Badge> : !r.providerConfigured ? <Badge tone="warning">No API key</Badge> : r.circuitOpenUntil ? <Badge tone="danger">Paused after errors</Badge> : <Badge tone="success">Healthy</Badge>;
  const cols = [
    { key: 'model', header: 'Model', cell: (r: AiRoute) => <div><div className="font-medium">{r.model}</div><div className="font-mono text-xs text-muted">{r.provider}</div></div> },
    { key: 'status', header: 'Status', cell: status },
    { key: 'prio', header: 'Priority', cell: (r: AiRoute) => r.priority, hideOnMobile: true },
    { key: 'cost', header: 'Our cost / 1M tokens', cell: (r: AiRoute) => r.inputCostPerMTokMicros === 0 && r.outputCostPerMTokMicros === 0 ? <Badge tone="success">Free</Badge> : `$${usd(r.inputCostPerMTokMicros)} in · $${usd(r.outputCostPerMTokMicros)} out`, hideOnMobile: true },
    { key: 'quality', header: 'Quality', cell: (r: AiRoute) => `${r.quality}`, hideOnMobile: true },
    { key: 'cap', header: 'Today / daily cap', cell: (r: AiRoute) => `${r.requestsToday}${r.dailyRequestLimit ? ` / ${r.dailyRequestLimit}` : ''}`, hideOnMobile: true },
    { key: 'ok', header: 'Success 24h', cell: (r: AiRoute) => (r.requests24h ? `${Math.round((r.successes24h / r.requests24h) * 100)}% of ${r.requests24h}` : '—'), hideOnMobile: true },
    { key: 'margin', header: 'Margin 24h', align: 'right' as const, cell: (r: AiRoute) => <span className={r.marginUsd24h < 0 ? 'text-danger' : ''}>{money(r.marginUsd24h)}</span> },
    { key: 'act', header: '', align: 'right' as const, cell: (r: AiRoute) => (
      <Menu align="end" trigger={<Button size="sm" variant="ghost" aria-label={`Actions for ${r.model}`}><MoreHorizontal className="size-4" /></Button>}>
        <MenuItem onSelect={() => setEdit(r)}>Edit</MenuItem>
        <MenuItem onSelect={() => save.mutate({ ...r, enabled: !r.enabled })}>{r.enabled ? 'Turn off' : 'Turn on'}</MenuItem>
        <MenuItem danger onSelect={async () => { const c = await confirm({ title: `Remove ${r.model}?`, body: 'Requests will use the other routes for this tier.', confirmLabel: 'Remove', danger: true }); if (c.ok) del.mutate(r.id); }}>Remove</MenuItem>
      </Menu>) },
  ];

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-muted">
        Customers pay each tier&rsquo;s fixed credit rate. Behind it, requests go to the cheapest route that meets the tier&rsquo;s quality floor (balanced 70, deep 90, fast 40), skip routes that are failing or out of free quota, and fall back automatically.
        Strategy: <span className="font-medium text-fg">{d.strategy === 'margin' ? 'maximise margin' : 'admin priority order'}</span> (set by <code className="font-mono">AI_ROUTING_STRATEGY</code>).
      </p>
      <Card><div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Stat label="Customer revenue, 24h" value={money(d.totals.revenueUsd24h)} hint={`${d.creditsPerUsd} credits = $1`} />
        <Stat label="AI cost, 24h" value={money(d.totals.costUsd24h)} />
        <Stat label="Margin, 24h" value={money(d.totals.marginUsd24h)} hint={d.totals.revenueUsd24h > 0 ? `${Math.round((d.totals.marginUsd24h / d.totals.revenueUsd24h) * 100)}% of revenue` : 'No usage yet'} />
      </div></Card>

      <Card>
        <h3 className="text-sm font-semibold">Providers</h3>
        <p className="mt-1 text-[13px] text-muted">A provider is used only after its API key is set in the server environment. Keys are never shown here.</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {d.providers.map((p) => <li key={p.name} title={p.configured ? 'Key configured' : `Set ${envName(p.name)} on the server`}><Badge tone={p.configured ? 'success' : 'neutral'}>{p.name}{p.configured ? '' : ' · no key'}</Badge></li>)}
        </ul>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold">What customers pay (per 1M tokens, USD)</h3>
        <p className="mt-1 text-[13px] text-muted">Credits are charged at this rate whichever model served the request. Our own cost is each route&rsquo;s price below.</p>
        <div className="mt-3 divide-y divide-border">
          {TIERS.map((t) => <TierRate key={t.tier} tier={t} current={d.tierRates.find((r) => r.tier === t.tier)} />)}
        </div>
      </Card>

      {TIERS.map((t) => {
        const rows = d.routes.filter((r) => r.tier === t.tier);
        return (
          <section key={t.tier} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold">{t.label} tier</h3><p className="text-[13px] text-muted">{t.blurb}</p></div>
              <Button size="sm" variant="secondary" onClick={() => setEdit({ ...EMPTY, tier: t.tier })}><Plus className="size-3.5" />Add route</Button>
            </div>
            <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} mobile={{ primary: (r) => r.model, secondary: (r) => `${r.provider} · ${money(r.marginUsd24h)} margin`, trailing: status }} empty={<Card><p className="text-sm text-muted">No routes for this tier yet.</p></Card>} />
          </section>
        );
      })}

      {edit && <RouteDialog route={edit} busy={save.isPending} onClose={() => setEdit(null)} onSave={(r) => save.mutate(r)} />}
    </div>
  );
}

function TierRate({ tier, current }: { tier: { tier: AiTier; label: string }; current?: { inputCostPerMTokMicros: number; outputCostPerMTokMicros: number } }) {
  const qc = useQueryClient();
  const [i, setI] = useState(current ? usd(current.inputCostPerMTokMicros) : '');
  const [o, setO] = useState(current ? usd(current.outputCostPerMTokMicros) : '');
  const valid = i !== '' && o !== '' && Number(i) >= 0 && Number(o) >= 0;
  const m = useMutation({ mutationFn: () => admin.setTierRate(tier.tier, { inputCostPerMTokMicros: toMicros(i), outputCostPerMTokMicros: toMicros(o) }), onSuccess: () => { toast.success(`${tier.label} rate saved`); void qc.invalidateQueries({ queryKey: ['admin-ai-routing'] }); }, onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="flex flex-wrap items-end gap-3 py-3 first:pt-0 last:pb-0">
      <div className="w-24 text-sm font-medium">{tier.label}</div>
      <Field label="Input $"><Input id={`in-${tier.tier}`} inputMode="decimal" value={i} onChange={(e) => setI(e.target.value)} className="w-28" /></Field>
      <Field label="Output $"><Input id={`out-${tier.tier}`} inputMode="decimal" value={o} onChange={(e) => setO(e.target.value)} className="w-28" /></Field>
      <Button size="sm" onClick={() => m.mutate()} disabled={!valid} loading={m.isPending}>Save</Button>
    </div>
  );
}

function RouteDialog({ route, busy, onClose, onSave }: { route: AiRouteInput; busy: boolean; onClose: () => void; onSave: (r: AiRouteInput) => void }) {
  const isNew = !route.model;
  const [f, setF] = useState({ provider: route.provider, model: route.model, tier: route.tier, priority: String(route.priority), quality: String(route.quality), inCost: usd(route.inputCostPerMTokMicros), outCost: usd(route.outputCostPerMTokMicros), reqCap: route.dailyRequestLimit?.toString() ?? '', tokCap: route.dailyTokenLimit?.toString() ?? '', enabled: route.enabled });
  const int = (v: string) => /^\d+$/.test(v.trim());
  const num = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  const valid = /^[a-z0-9_-]{2,30}$/.test(f.provider) && f.model.trim() !== '' && int(f.priority) && int(f.quality) && Number(f.quality) <= 100 && num(f.inCost) && num(f.outCost) && (f.reqCap === '' || int(f.reqCap)) && (f.tokCap === '' || int(f.tokCap));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={isNew ? 'Add a route' : `Edit ${route.model}`} description="Prices and limits come from the provider's own pricing and free-tier pages. Check them there; they change." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={busy} onClick={() => onSave({ provider: f.provider, model: f.model.trim(), tier: f.tier, priority: Number(f.priority), enabled: f.enabled, inputCostPerMTokMicros: toMicros(f.inCost), outputCostPerMTokMicros: toMicros(f.outCost), quality: Number(f.quality), dailyRequestLimit: f.reqCap === '' ? null : Number(f.reqCap), dailyTokenLimit: f.tokCap === '' ? null : Number(f.tokCap) })}>Save route</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider" hint="e.g. groq, gemini"><Input id="rt-provider" value={f.provider} disabled={!isNew} onChange={(e) => setF({ ...f, provider: e.target.value.toLowerCase() })} /></Field>
        <Field label="Model"><Input id="rt-model" value={f.model} disabled={!isNew} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
        <Field label="Our cost: input $ / 1M"><Input id="rt-in" inputMode="decimal" value={f.inCost} onChange={(e) => setF({ ...f, inCost: e.target.value })} /></Field>
        <Field label="Our cost: output $ / 1M"><Input id="rt-out" inputMode="decimal" value={f.outCost} onChange={(e) => setF({ ...f, outCost: e.target.value })} /></Field>
        <Field label="Quality (0–100)" hint="Below the tier floor it is never used"><Input id="rt-q" inputMode="numeric" value={f.quality} onChange={(e) => setF({ ...f, quality: e.target.value })} /></Field>
        <Field label="Priority" hint="Lower is tried first on ties"><Input id="rt-p" inputMode="numeric" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
        <Field label="Daily request cap" hint="Blank = none. Use the free-tier limit"><Input id="rt-rc" inputMode="numeric" value={f.reqCap} onChange={(e) => setF({ ...f, reqCap: e.target.value })} /></Field>
        <Field label="Daily token cap" hint="Blank = none"><Input id="rt-tc" inputMode="numeric" value={f.tokCap} onChange={(e) => setF({ ...f, tokCap: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Segmented label="Status" value={f.enabled ? 'on' : 'off'} onChange={(v) => setF({ ...f, enabled: v === 'on' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} /></div>
    </Dialog>
  );
}
