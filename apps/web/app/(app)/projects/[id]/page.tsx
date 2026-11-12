'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, Check, CircleDashed, FileCode2, History, MessageSquare, RotateCcw, Send } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { projectTypeOption } from '@/components/project-types';
import { Button, Card, EmptyState, ErrorNotice, Skeleton, StatusBadge, Textarea } from '@/components/ui';
import { api, type Run, type RunEvent } from '@/lib/api';

const ACTIVE = new Set(['queued', 'running']);
type Tab = 'chat' | 'files' | 'versions';

export default function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('chat');
  const [panel, setPanel] = useState<'files' | 'versions'>('files');

  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
  const runs = useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.runs(id),
    refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE.has(r.status)) ? 2000 : false),
  });
  const activeRun = runs.data?.find((r) => ACTIVE.has(r.status));

  // When a run finishes, refresh everything derived from the project's head version.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !activeRun) {
      for (const k of ['project', 'files', 'versions', 'approvals', 'credits']) void qc.invalidateQueries({ queryKey: k === 'credits' ? [k] : [k, id] });
    }
    wasActive.current = !!activeRun;
  }, [activeRun, qc, id]);

  if (project.error) return <ErrorNotice error={project.error} />;
  const opt = project.data ? projectTypeOption(project.data.type) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link href="/projects" className="rounded-[var(--radius-md)] p-1.5 text-muted hover:bg-surface-muted" aria-label="Back to projects"><ArrowLeft className="size-4" /></Link>
        <div className="min-w-0 flex-1">
          {project.data ? <h1 className="truncate text-xl font-semibold tracking-tight">{project.data.name}</h1> : <Skeleton className="h-7 w-48" />}
          <div className="text-sm text-muted">{opt?.label}</div>
        </div>
        {project.data && <StatusBadge status={project.data.status} />}
      </div>

      <div className="grid grid-cols-3 rounded-[var(--radius-md)] border border-border bg-surface p-1 lg:hidden" role="tablist">
        {([['chat', 'Chat', MessageSquare], ['files', 'Files', FileCode2], ['versions', 'Versions', History]] as const).map(([t, label, Icon]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-2 text-sm font-medium', tab === t ? 'bg-brand-soft text-brand' : 'text-muted')}>
            <Icon className="size-4" aria-hidden />{label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className={clsx(tab !== 'chat' && 'hidden lg:block')}>
          <ChatPanel projectId={id} runs={runs.data} activeRun={activeRun} />
        </div>
        <div className={clsx(tab === 'chat' && 'hidden lg:block')}>
          <div className="mb-3 hidden gap-1 lg:flex" role="tablist">
            {(['files', 'versions'] as const).map((p) => (
              <button key={p} role="tab" aria-selected={panel === p} onClick={() => { setPanel(p); setTab('chat'); }} className={clsx('rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium capitalize', panel === p ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-muted')}>{p}</button>
            ))}
          </div>
          {(tab === 'chat' ? panel : tab) === 'files' ? <FilesPanel projectId={id} /> : <VersionsPanel projectId={id} busy={!!activeRun} />}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ projectId, runs, activeRun }: { projectId: string; runs: Run[] | undefined; activeRun: Run | undefined }) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const send = useMutation({
    mutationFn: () => api.generate(projectId, prompt.trim()),
    onSuccess: () => {
      setPrompt('');
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
  const ordered = useMemo(() => [...(runs ?? [])].reverse(), [runs]);
  const hasVersion = runs?.some((r) => r.status === 'succeeded');

  return (
    <Card className="flex h-[calc(100dvh-14rem)] min-h-[420px] flex-col lg:h-[calc(100dvh-11rem)]">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!runs ? <Skeleton className="h-24" /> : ordered.length === 0 ? (
          <EmptyState icon={<MessageSquare className="size-5" />} title="Describe what to build" body="Your first message generates the project. After that, ask for changes in plain language." />
        ) : ordered.map((r) => <RunItem key={r.id} run={r} live={r.id === activeRun?.id} />)}
        <ApprovalsInline projectId={projectId} />
      </div>
      <form className="border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); if (prompt.trim().length >= 3) send.mutate(); }}>
        {send.error ? <div className="mb-2"><ErrorNotice error={send.error} /></div> : null}
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (prompt.trim().length >= 3) send.mutate(); } }}
            placeholder={hasVersion ? 'Ask for a change — e.g. "Make the design more premium"' : 'Describe your project'}
            disabled={!!activeRun}
            aria-label="Message"
          />
          <Button type="submit" aria-label="Send" disabled={!!activeRun || prompt.trim().length < 3} loading={send.isPending}><Send className="size-4" /></Button>
        </div>
        {activeRun && <p className="mt-2 text-xs text-muted">Working on your request…</p>}
      </form>
    </Card>
  );
}

function RunItem({ run, live }: { run: Run; live: boolean }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const after = useRef('0');
  const finished = !ACTIVE.has(run.status);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const next = await api.events(run.id, after.current);
        if (next.length) {
          after.current = next[next.length - 1]!.id;
          setEvents((e) => [...e, ...next]);
        }
      } catch {
        /* transient; retry on next tick */
      }
      if (!stop && live) setTimeout(poll, 1500);
    }
    void poll();
    return () => { stop = true; };
  }, [run.id, live, finished]);

  const visible = events.filter((e) => e.type !== 'check.started' || live);
  return (
    <div className="space-y-2">
      <div className="ml-auto max-w-[85%] rounded-[var(--radius-lg)] rounded-br-sm bg-brand px-3.5 py-2.5 text-sm text-brand-fg">{run.prompt}</div>
      <div className="max-w-[92%] space-y-1.5 rounded-[var(--radius-lg)] rounded-bl-sm bg-surface-muted px-3.5 py-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={run.status} />
          {run.creditsUsed > 0 && <span className="text-xs text-subtle">{run.creditsUsed} credits</span>}
        </div>
        <ul className="space-y-1">
          {visible.map((e) => (
            <li key={e.id} className="flex gap-2 text-muted">
              {e.type.endsWith('failed') ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" /> : e.type.endsWith('skipped') || e.type.endsWith('started') ? <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-subtle" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-success" />}
              <span className="min-w-0 break-words">{e.message}</span>
            </li>
          ))}
        </ul>
        {run.error && <p className="text-danger">{run.error}</p>}
      </div>
    </div>
  );
}

function ApprovalsInline({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const approvals = useQuery({ queryKey: ['approvals', projectId], queryFn: () => api.approvals(projectId) });
  const decide = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => api.decide(id, ok),
    onSettled: () => {
      for (const k of ['approvals', 'files', 'versions', 'runs']) void qc.invalidateQueries({ queryKey: [k, projectId] });
    },
  });
  const pending = approvals.data?.filter((a) => a.status === 'pending') ?? [];
  if (!pending.length) return null;
  return (
    <>
      {pending.map((a) => (
        <div key={a.id} className="space-y-3 rounded-[var(--radius-lg)] border border-warning/40 bg-warning/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="size-4" />Approval needed</div>
          <p className="whitespace-pre-wrap text-muted">{a.summary}</p>
          {decide.error ? <ErrorNotice error={decide.error} /> : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide.mutate({ id: a.id, ok: true })} loading={decide.isPending}>Apply change</Button>
            <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: a.id, ok: false })} disabled={decide.isPending}>Discard</Button>
          </div>
        </div>
      ))}
    </>
  );
}

function FilesPanel({ projectId }: { projectId: string }) {
  const files = useQuery({ queryKey: ['files', projectId], queryFn: () => api.files(projectId) });
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? files.data?.find((f) => f.path === 'app/page.tsx')?.path ?? files.data?.[0]?.path ?? null;
  const file = useQuery({ queryKey: ['file', projectId, current], queryFn: () => api.file(projectId, current!), enabled: !!current });

  if (files.error) return <ErrorNotice error={files.error} />;
  if (!files.data) return <Skeleton className="h-96" />;
  if (files.data.length === 0) return <Card><EmptyState icon={<FileCode2 className="size-5" />} title="No files yet" body="Files appear here once your first generation finishes." /></Card>;

  return (
    <Card className="grid overflow-hidden md:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="max-h-56 overflow-y-auto border-b border-border p-2 md:max-h-[calc(100dvh-14rem)] md:border-r md:border-b-0" aria-label="Files">
        {files.data.map((f) => (
          <button key={f.path} onClick={() => setSelected(f.path)} className={clsx('block w-full truncate rounded-[var(--radius-sm)] px-2 py-1.5 text-left font-mono text-xs', f.path === current ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-muted')} title={f.path}>{f.path}</button>
        ))}
      </nav>
      <div className="min-w-0">
        <div className="border-b border-border px-4 py-2 font-mono text-xs text-muted">{current}</div>
        {file.data ? (
          <pre className="max-h-[calc(100dvh-16rem)] overflow-auto p-4 font-mono text-[13px] leading-relaxed"><code>{file.data.content ?? '(binary or large file)'}</code></pre>
        ) : <div className="p-4"><Skeleton className="h-64" /></div>}
      </div>
    </Card>
  );
}

function VersionsPanel({ projectId, busy }: { projectId: string; busy: boolean }) {
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ['versions', projectId], queryFn: () => api.versions(projectId) });
  const restore = useMutation({
    mutationFn: (versionId: string) => api.restore(projectId, versionId),
    onSuccess: () => {
      for (const k of ['versions', 'files', 'file']) void qc.invalidateQueries({ queryKey: [k, projectId] });
    },
  });
  if (versions.error) return <ErrorNotice error={versions.error} />;
  if (!versions.data) return <Skeleton className="h-64" />;
  if (versions.data.length === 0) return <Card><EmptyState icon={<History className="size-5" />} title="No versions yet" body="Every successful generation or edit is saved as a version you can restore." /></Card>;
  return (
    <Card className="divide-y divide-border">
      {restore.error ? <div className="p-3"><ErrorNotice error={restore.error} /></div> : null}
      {versions.data.map((v) => (
        <div key={v.id} className="flex items-center gap-3 p-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold">v{v.number}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{v.message}</div>
            <div className="text-xs text-subtle">{new Date(v.createdAt).toLocaleString()} · <span className="font-mono">{v.commitSha.slice(0, 7)}</span></div>
          </div>
          {v.isHead ? <span className="text-xs font-medium text-success">Current</span> : (
            <Button size="sm" variant="secondary" disabled={busy} loading={restore.isPending && restore.variables === v.id} onClick={() => restore.mutate(v.id)}><RotateCcw className="size-3.5" />Restore</Button>
          )}
        </div>
      ))}
    </Card>
  );
}
