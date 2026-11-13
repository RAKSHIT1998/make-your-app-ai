'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Lock, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { api, type AppEnv } from '@/lib/api';
import { Badge, Button, cx, EmptyState, ErrorNotice, Segmented, Skeleton, toast, useConfirm } from './ui';

const RULE: Record<string, string> = { public: 'anyone', users: 'signed-in users', owner: 'only its creator', none: 'nobody' };
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));

/** The owner's view of a full-stack app's built-in backend: collections, records and end users, per environment. */
export function AppDataView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [env, setEnv] = useState<AppEnv>('preview');
  const [tab, setTab] = useState<string>('');
  const ov = useQuery({ queryKey: ['appdata', projectId, env], queryFn: () => api.appData(projectId, env) });
  const current = tab || ov.data?.collections[0]?.name || (ov.data?.backend?.auth.enabled ? '__users' : '');
  const records = useQuery({ queryKey: ['appdata-records', projectId, env, current], queryFn: () => api.appRecords(projectId, env, current), enabled: !!current && current !== '__users' && !!ov.data?.available });
  const users = useQuery({ queryKey: ['appdata-users', projectId, env], queryFn: () => api.appUsers(projectId, env), enabled: current === '__users' && !!ov.data?.available });
  const refresh = () => { for (const k of ['appdata', 'appdata-records', 'appdata-users']) void qc.invalidateQueries({ queryKey: [k, projectId] }); };
  const delRecord = useMutation({ mutationFn: (id: string) => api.deleteAppRecord(projectId, env, id), onSuccess: () => { refresh(); toast.success('Record deleted'); }, onError: (e) => toast.error((e as Error).message) });
  const delUser = useMutation({ mutationFn: (id: string) => api.deleteAppUser(projectId, env, id), onSuccess: () => { refresh(); toast.success('Account and its data deleted'); }, onError: (e) => toast.error((e as Error).message) });
  const clear = useMutation({ mutationFn: () => api.clearPreviewData(projectId), onSuccess: (r) => { refresh(); toast.success(`Cleared ${r.records} records and ${r.users} test accounts`); }, onError: (e) => toast.error((e as Error).message) });

  const o = ov.data;
  const col = o?.collections.find((c) => c.name === current);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Segmented label="Environment" value={env} onChange={(v) => { setEnv(v); setTab(''); }} options={[{ value: 'preview', label: 'Preview' }, { value: 'live', label: 'Live' }]} />
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{env === 'preview' ? 'Test data from your preview. Your published app never sees it.' : 'Real data from people using your published app.'}</span>
        {env === 'preview' && o?.available && (o.users > 0 || o.collections.some((c) => c.records > 0)) && (
          <Button size="sm" variant="ghost" loading={clear.isPending} onClick={async () => { const r = await confirm({ title: 'Clear all preview data?', body: 'Every test record and test account in the preview is deleted. Live data is not touched.', confirmLabel: 'Clear preview data', danger: true }); if (r.ok) clear.mutate(); }}>Clear preview data</Button>
        )}
      </div>
      {ov.error ? <div className="p-4"><ErrorNotice error={ov.error} onRetry={() => ov.refetch()} /></div>
        : !o ? <div className="p-4"><Skeleton className="h-48" /></div>
        : !o.available ? <EmptyState icon={<Database className="size-5" />} title={env === 'live' ? 'Not live yet' : 'No backend yet'} body={env === 'live' ? 'Publish the app to give it a live database. Live data starts empty and is kept separate from your preview.' : 'Ask the AI for features that save data or need accounts, and the backend appears here.'} />
        : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div role="tablist" aria-label="Data" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5 [scrollbar-width:none]">
              {o.collections.map((c) => (
                <button key={c.name} role="tab" aria-selected={current === c.name} onClick={() => setTab(c.name)} className={cx('flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 font-mono text-xs', current === c.name ? 'bg-surface-muted text-fg' : 'text-muted hover:text-fg')}>{c.name}<span className="tabular-nums text-subtle">{c.records}</span></button>
              ))}
              {o.backend?.auth.enabled && <button role="tab" aria-selected={current === '__users'} onClick={() => setTab('__users')} className={cx('flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 text-xs', current === '__users' ? 'bg-surface-muted text-fg' : 'text-muted hover:text-fg')}><Users className="size-3" />Accounts<span className="tabular-nums text-subtle">{o.users}</span></button>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {col && (
                <>
                  <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><Lock className="size-3" />Read: {RULE[col.access.read]} · Create: {RULE[col.access.create]} · Edit/delete: {RULE[col.access.modify]}</p>
                  {records.error ? <ErrorNotice error={records.error} onRetry={() => records.refetch()} /> : !records.data ? <Skeleton className="h-32" /> : records.data.items.length === 0 ? <p className="py-8 text-center text-sm text-muted">No records yet.</p> : (
                    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
                      <table className="w-full text-left text-[13px]">
                        <thead className="bg-surface-muted/60 text-xs text-muted"><tr>{col.fields.map((f) => <th key={f.name} className="whitespace-nowrap px-3 py-2 font-medium">{f.name}</th>)}<th className="px-3 py-2 font-medium">Created by</th><th className="px-3 py-2 font-medium">Created</th><th className="w-8" /></tr></thead>
                        <tbody className="divide-y divide-border">
                          {records.data.items.map((r) => (
                            <tr key={r.id}>
                              {col.fields.map((f) => <td key={f.name} className="max-w-[240px] truncate px-3 py-2">{show(r.data[f.name])}</td>)}
                              <td className="max-w-[180px] truncate px-3 py-2 text-muted">{r.owner ?? 'signed out visitor'}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted">{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                              <td className="px-1"><Button size="sm" variant="ghost" aria-label="Delete record" onClick={async () => { const c = await confirm({ title: 'Delete this record?', body: env === 'live' ? 'This is real data from your live app. It cannot be recovered.' : 'This test record is deleted.', confirmLabel: 'Delete', danger: true }); if (c.ok) delRecord.mutate(r.id); }}><Trash2 className="size-3.5" /></Button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {records.data?.nextCursor && <p className="mt-2 text-xs text-subtle">Showing the newest 50.</p>}
                </>
              )}
              {current === '__users' && (users.error ? <ErrorNotice error={users.error} /> : !users.data ? <Skeleton className="h-32" /> : users.data.length === 0 ? <p className="py-8 text-center text-sm text-muted">No accounts yet.</p> : (
                <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border text-[13px]">
                  {users.data.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{u.email}</span>
                      <span className="hidden shrink-0 text-xs text-muted sm:inline">joined {new Date(u.createdAt).toLocaleDateString()}</span>
                      <Badge tone="neutral">{u.records} record{u.records === 1 ? '' : 's'}</Badge>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${u.email}`} onClick={async () => { const c = await confirm({ title: `Delete ${u.email}?`, body: 'The account, its sessions and every record it created are deleted. It cannot be undone.', confirmLabel: 'Delete account', danger: true }); if (c.ok) delUser.mutate(u.id); }}><Trash2 className="size-3.5" /></Button>
                    </li>
                  ))}
                </ul>
              ))}
              <p className="mt-4 text-xs text-subtle">{o.limits.records.toLocaleString()} records and {o.limits.users.toLocaleString()} accounts per environment.{o.orphanedRecords > 0 ? ` ${o.orphanedRecords} records belong to collections that were removed from the app.` : ''}</p>
            </div>
          </div>
        )}
    </div>
  );
}
