'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleDashed, Download, Lock, Smartphone, User } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNotice, Field, Input, Notice, PageHeader, SectionTitle, Skeleton, toast } from '@/components/ui';
import { api, appStudio, downloadSource, type AppConfig } from '@/lib/api';

const reverseDns = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9_]*){2,}$/;

export default function AppSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
  const st = useQuery({ queryKey: ['app-config', id], queryFn: () => appStudio.config(id) });
  const [f, setF] = useState<AppConfig | null>(null);
  useEffect(() => { if (st.data?.config) setF(st.data.config); }, [st.data?.config]);
  const save = useMutation({
    mutationFn: () => appStudio.update(id, f!),
    onSuccess: (d) => { qc.setQueryData(['app-config', id], d); for (const k of ['versions', 'files', 'file']) void qc.invalidateQueries({ queryKey: [k, id] }); toast.success('App settings saved as a new version'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const [downloading, setDownloading] = useState(false);
  const download = async () => { setDownloading(true); try { await downloadSource(id); } catch (e) { toast.error((e as Error).message); } finally { setDownloading(false); } };

  const errors = f ? {
    name: !f.name.trim() || f.name.length > 30 ? '1–30 characters' : null,
    slug: /^[a-z0-9-]{2,40}$/.test(f.slug) ? null : 'Lowercase letters, numbers and hyphens',
    version: /^\d+\.\d+\.\d+$/.test(f.version) ? null : 'Like 1.0.0',
    iosBundleId: reverseDns.test(f.iosBundleId) ? null : 'Like com.yourcompany.app',
    androidPackage: reverseDns.test(f.androidPackage) && !f.androidPackage.includes('-') ? null : 'Like com.yourcompany.app (no hyphens)',
    primaryColor: /^#[0-9a-fA-F]{6}$/.test(f.primaryColor) ? null : 'Hex colour',
    splashColor: /^#[0-9a-fA-F]{6}$/.test(f.splashColor) ? null : 'Hex colour',
    privacyPolicyUrl: !f.privacyPolicyUrl || /^https?:\/\/.+\..+/.test(f.privacyPolicyUrl) ? null : 'Full URL starting with https://',
  } : {};
  const valid = !!f && Object.values(errors).every((e) => !e);
  const dirty = !!f && JSON.stringify(f) !== JSON.stringify(st.data?.config);
  const set = (k: keyof AppConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f!, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/studio/app" className="flex size-9 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-muted hover:text-fg" aria-label="Back to App Studio"><ArrowLeft className="size-4" /></Link>
        <div className="min-w-0 flex-1"><PageHeader title={project.data?.name ?? 'App settings'} description="App identity, release details and your source code." /></div>
      </div>
      {st.error ? <ErrorNotice error={st.error} onRetry={() => st.refetch()} /> : !st.data ? <Skeleton className="h-96" /> : !st.data.generated ? (
        <Notice action={<Link href={`/projects/${id}`}><Button size="sm">Open workspace</Button></Link>}>Generate the app first — its settings live in the generated app.json.</Notice>
      ) : f && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Card className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex size-14 items-center justify-center rounded-[14px] text-xl font-semibold text-white shadow-sm" style={{ background: errors.primaryColor ? '#111' : f.primaryColor }} aria-hidden>{f.name.slice(0, 1).toUpperCase() || '?'}</span>
                <div className="min-w-0"><div className="font-semibold">{f.name || 'Your app'}</div><div className="text-xs text-muted">v{f.version} · placeholder icon until icon upload is available</div></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="App name" error={errors.name}><Input value={f.name} onChange={set('name')} maxLength={30} /></Field>
                <Field label="Slug" hint="Expo project identifier" error={errors.slug}><Input value={f.slug} onChange={set('slug')} className="font-mono" /></Field>
                <Field label="Version" hint="Bumping it increases the iOS build number and Android version code" error={errors.version}><Input value={f.version} onChange={set('version')} className="font-mono" /></Field>
                <Field label="Privacy policy URL" error={errors.privacyPolicyUrl}><Input value={f.privacyPolicyUrl} onChange={set('privacyPolicyUrl')} placeholder="https://yourbusiness.com/privacy" /></Field>
              </div>
            </Card>
            <Card className="space-y-4">
              <SectionTitle>Store identifiers</SectionTitle>
              <Notice tone="warning">These can’t be changed after your app is published on a store. Use a domain you control.</Notice>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="iOS bundle identifier" error={errors.iosBundleId}><Input value={f.iosBundleId} onChange={set('iosBundleId')} className="font-mono" autoCapitalize="none" spellCheck={false} /></Field>
                <Field label="Android package" error={errors.androidPackage}><Input value={f.androidPackage} onChange={set('androidPackage')} className="font-mono" autoCapitalize="none" spellCheck={false} /></Field>
              </div>
            </Card>
            <Card className="space-y-4">
              <SectionTitle>Colours</SectionTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(['primaryColor', 'splashColor'] as const).map((k) => (
                  <Field key={k} label={k === 'primaryColor' ? 'Primary colour' : 'Splash & icon background'} error={errors[k]}>
                    <div className="flex gap-2"><input type="color" aria-label={k} value={errors[k] ? '#000000' : f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="h-10 w-12 cursor-pointer rounded-[var(--radius-md)] border border-border bg-surface p-1" /><Input value={f[k]} onChange={set(k)} className="font-mono" /></div>
                  </Field>
                ))}
              </div>
            </Card>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!valid || !dirty} loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
              {dirty && <Button variant="ghost" onClick={() => setF(st.data!.config)}>Discard changes</Button>}
            </div>
          </div>

          <aside className="space-y-4">
            <Card className="space-y-3">
              <SectionTitle>Release checklist</SectionTitle>
              <ul className="space-y-3">
                {st.data.checklist.map((c) => (
                  <li key={c.key} className="flex gap-3 text-sm">
                    {c.done ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : c.blocked ? <Lock className="mt-0.5 size-4 shrink-0 text-subtle" /> : c.manual ? <User className="mt-0.5 size-4 shrink-0 text-subtle" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-subtle" />}
                    <div><div className="font-medium">{c.label}{c.blocked && <Badge className="ml-2">Soon</Badge>}</div><div className="text-[13px] text-muted">{c.detail}</div></div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="space-y-3">
              <SectionTitle>Builds</SectionTitle>
              <p className="text-[13px] text-muted">Managed iOS and Android builds aren’t connected yet. You can build today with your own Expo account:</p>
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
                <li>Download the source below and unzip it.</li>
                <li>Run <code className="font-mono text-xs text-fg">npm install</code>, then <code className="font-mono text-xs text-fg">npx eas-cli build --platform all</code>.</li>
                <li>Submit to the stores from your own Apple and Google accounts.</li>
              </ol>
              <Button variant="secondary" className="w-full" loading={downloading} onClick={download}><Download className="size-4" />Download source (.zip)</Button>
              <p className="flex items-center gap-1.5 text-xs text-subtle"><Smartphone className="size-3.5" />Store approval is decided by Apple and Google — we never publish for you.</p>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
