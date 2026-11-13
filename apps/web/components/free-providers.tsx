'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { admin, type AiTier, type FreeProvider } from '@/lib/api';
import { Badge, Button, Card, cx, Dialog, ErrorNotice, Field, Input, Notice, Segmented, Skeleton, toast } from './ui';

/**
 * Free AI providers: what each offers, whether its key is set, and the free models it lists right now.
 * One click adds a model as a $0 route; the router then prefers it wherever it meets the tier's quality floor.
 */
export function FreeProvidersCard() {
  const qc = useQueryClient();
  const [refresh, setRefresh] = useState(0);
  const q = useQuery({ queryKey: ['admin-free-providers', refresh], queryFn: () => admin.freeProviders(refresh > 0), placeholderData: (p) => p });
  const [adding, setAdding] = useState<{ p: FreeProvider; model: string } | null>(null);
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => q.refetch()} />;
  const list = q.data;
  const ready = list?.filter((p) => p.configured).length ?? 0;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-accent" />Free AI providers</h3>
          <p className="mt-1 text-[13px] text-muted">Each one costs you nothing within its free quota while customers still pay the normal rate. Add a key to the server environment, then add the models you want. {list ? `${ready} of ${list.length} connected.` : ''}</p>
        </div>
        <Button size="sm" variant="ghost" loading={q.isFetching} onClick={() => setRefresh((n) => n + 1)}><RefreshCw className="size-3.5" />Check again</Button>
      </div>
      {!list ? <Skeleton className="h-40" /> : (
        <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
          {list.map((p) => (
            <li key={p.key} className="space-y-2 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.configured ? <Badge tone="success" dot>Key set</Badge> : <Badge tone="neutral">Not connected</Badge>}
                <a href={p.signupUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-fg">Get a free key<ExternalLink className="size-3" /></a>
              </div>
              <p className="text-[13px] text-muted">{p.freeTier} <a href={p.docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">Limits</a></p>
              {p.dataNote && <p className="flex items-start gap-1.5 text-[13px] text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{p.dataNote}</p>}
              {!p.configured ? (
                <p className="text-xs text-subtle">Set <code className="font-mono">{p.env.join(' and ')}</code> on the server and restart it.</p>
              ) : p.error ? <Notice tone="warning">{p.error}</Notice> : p.models.length === 0 ? <p className="text-xs text-subtle">No free chat models listed right now.</p> : (
                <div className="flex flex-wrap gap-1.5">
                  {p.models.slice(0, 40).map((m) => m.route ? (
                    <Badge key={m.id} tone={m.route.enabled ? 'success' : 'neutral'} className="max-w-full"><span className="truncate font-mono">{m.id}</span> · {m.route.tier}</Badge>
                  ) : (
                    <button key={m.id} type="button" onClick={() => setAdding({ p, model: m.id })} className="max-w-full truncate rounded-full border border-dashed border-border px-2 py-0.5 font-mono text-xs text-muted hover:border-fg hover:text-fg" aria-label={`Add ${m.id}`}>+ {m.id}</button>
                  ))}
                  {p.models.length > 40 && <span className="text-xs text-subtle">and {p.models.length - 40} more</span>}
                </div>
              )}
              {p.accountWideQuota && p.configured && <p className="text-xs text-subtle">The free quota is shared by the whole account, so one or two models from this provider is usually best.</p>}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddFreeRoute p={adding.p} model={adding.model} onClose={() => setAdding(null)} onAdded={() => { setAdding(null); void qc.invalidateQueries({ queryKey: ['admin-ai-routing'] }); void qc.invalidateQueries({ queryKey: ['admin-free-providers'] }); }} />}
    </Card>
  );
}

function AddFreeRoute({ p, model, onClose, onAdded }: { p: FreeProvider; model: string; onClose: () => void; onAdded: () => void }) {
  const [tier, setTier] = useState<AiTier>('fast');
  const [quality, setQuality] = useState('60');
  const [req, setReq] = useState(p.defaults.dailyRequestLimit?.toString() ?? '');
  const [tok, setTok] = useState(p.defaults.dailyTokenLimit?.toString() ?? '');
  const [test, setTest] = useState<{ ok: boolean; latencyMs: number; error: string | null } | null>(null);
  const floor = { fast: 40, balanced: 70, deep: 90 }[tier];
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const valid = /^\d+$/.test(quality) && Number(quality) <= 100 && [req, tok].every((v) => v.trim() === '' || /^[1-9]\d*$/.test(v));
  const probe = useMutation({ mutationFn: () => admin.testRoute({ provider: p.key, model }), onSuccess: setTest, onError: (e) => toast.error((e as Error).message) });
  const save = useMutation({
    mutationFn: () => admin.saveRoute({ provider: p.key, model, tier, priority: 50, enabled: true, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0, quality: Number(quality), dailyRequestLimit: num(req), dailyTokenLimit: num(tok) }),
    onSuccess: () => { toast.success('Free route added. It applies immediately.'); onAdded(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Add ${model}`} description={`${p.name} · costs $0 within the free quota`}>
      <div className="space-y-4">
        <Segmented label="Tier" value={tier} onChange={setTier} options={[{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'deep', label: 'Deep' }]} />
        <p className="text-[13px] text-muted">{tier === 'fast' ? 'Fast serves answers, Ask mode and other light work: the safest place to start with a free model.' : tier === 'balanced' ? 'Balanced writes and edits customers’ code. Only use a model here after it has passed a few real builds.' : 'Deep handles the hardest work. Free models rarely belong here.'}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Quality (0–100)" hint={`Used for ${tier} only if ${floor} or more`}><Input inputMode="numeric" value={quality} onChange={(e) => setQuality(e.target.value)} /></Field>
          <Field label="Requests per day" hint="Empty = no cap"><Input inputMode="numeric" value={req} onChange={(e) => setReq(e.target.value)} /></Field>
          <Field label="Tokens per day" hint="Empty = no cap"><Input inputMode="numeric" value={tok} onChange={(e) => setTok(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-subtle">Caps are prefilled from {p.name}’s published free tier. Your account’s exact limits may differ. If the provider refuses a request, the router moves on to the next route at once.</p>
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-surface-muted/70 p-3">
          <Button size="sm" variant="secondary" loading={probe.isPending} onClick={() => probe.mutate()}>Test with one real call</Button>
          {test && <span className={cx('text-[13px]', test.ok ? 'text-success' : 'text-danger')}>{test.ok ? `Works · returned valid JSON in ${(test.latencyMs / 1000).toFixed(1)}s` : test.error}</span>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!valid} loading={save.isPending}>Add route</Button>
        </div>
      </div>
    </Dialog>
  );
}
