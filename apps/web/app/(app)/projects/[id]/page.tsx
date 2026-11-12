'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowUp, Check, ChevronRight, CircleDashed, Code2, Eye, FileCode2, FileMinus, FilePlus, FileText, Folder, History, ListTree, Loader2, MessageSquare, RotateCcw, ScrollText, Share2, X, ListChecks, Hammer } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { projectTypeOption } from '@/components/project-types';
import { timeAgo } from '@/components/project-card';
import { PublishPanel } from '@/components/growth/publish-panel';
import { Badge, Button, cx, Drawer, EmptyState, ErrorNotice, Kbd, Skeleton, SoonBadge, StatusBadge, Tabs, Textarea, toast, Tooltip, useConfirm } from '@/components/ui';
import { api, ApiError, type PlanDraft, type Run, type RunEvent } from '@/lib/api';
import { VoiceButton } from '@/components/voice-button';

const ACTIVE = new Set(['queued', 'running']);
type Center = 'code' | 'versions' | 'logs' | 'preview';
type MobileTab = 'chat' | 'files' | 'code' | 'versions';

/** Polls a run's event stream (cursor = last event id) while the run is live. */
function useRunEvents(runId: string, live: boolean) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const after = useRef('0');
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.events(runId, after.current);
        if (!stop && next.length) {
          after.current = next[next.length - 1]!.id;
          setEvents((e) => [...e, ...next]);
        }
      } catch {
        /* transient: retried on the next tick */
      }
      if (!stop && live) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [runId, live]);
  return events;
}

export default function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
  const runs = useQuery({ queryKey: ['runs', id], queryFn: () => api.runs(id), refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE.has(r.status)) ? 2000 : false) });
  const files = useQuery({ queryKey: ['files', id], queryFn: () => api.files(id) });
  const activeRun = runs.data?.find((r) => ACTIVE.has(r.status));
  const [center, setCenter] = useState<Center>('code');
  const [file, setFile] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const desktop = useIsDesktop();
  const [sharing, setSharing] = useState(false);

  // When a run finishes, refresh everything derived from the project's head version and tell the user.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !activeRun) {
      for (const k of ['project', 'files', 'versions', 'approvals', 'file']) void qc.invalidateQueries({ queryKey: [k, id] });
      for (const k of ['credits', 'billing', 'activity', 'projects', 'estimate', 'achievements', 'timeline']) void qc.invalidateQueries({ queryKey: [k] });
      const last = runs.data?.[0];
      if (last?.status === 'succeeded' && last.kind === 'plan') toast.success('Your plan is ready — review it in the chat', { id: `run-${id}` });
      else if (last?.status === 'succeeded') toast.success('Changes saved as a new version', { id: `run-${id}` });
      else if (last?.status === 'failed') toast.error('The AI run failed — details are in the chat', { id: `run-${id}` });
      else if (last?.status === 'awaiting_approval') toast.warning('A change needs your approval', { id: `run-${id}` });
    }
    wasActive.current = !!activeRun;
  }, [activeRun, qc, id, runs.data]);

  const current = file && files.data?.some((f) => f.path === file) ? file : (files.data?.find((f) => f.path === 'app/page.tsx')?.path ?? files.data?.[0]?.path ?? null);
  const opt = project.data ? projectTypeOption(project.data.type) : undefined;
  if (project.error) return <div className="p-6"><ErrorNotice error={project.error} /></div>;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border bg-bg px-3 pt-[env(safe-area-inset-top)] md:px-4">
        <Tooltip content="All projects">
          <Link href="/projects" className="flex size-9 items-center justify-center rounded-[var(--radius-md)] text-muted hover:bg-surface-muted hover:text-fg" aria-label="Back to projects"><ArrowLeft className="size-4" /></Link>
        </Tooltip>
        <div className="min-w-0 flex-1">
          {project.data ? <h1 className="truncate text-sm font-semibold">{project.data.name}</h1> : <Skeleton className="h-4 w-40" />}
          <div className="truncate text-xs text-subtle">{opt?.label}{runs.data?.[0] ? ` · last change ${timeAgo(runs.data[0].createdAt)}` : ''}</div>
        </div>
        {activeRun ? <Badge tone="accent" dot pulse>AI working</Badge> : project.data && <span className="hidden sm:inline-flex"><StatusBadge status={project.data.status} /></span>}
        <Button size="sm" variant="secondary" onClick={() => setSharing(true)}><Share2 className="size-3.5" />Share</Button>
      </header>
      <Drawer open={sharing} onOpenChange={setSharing} title="Publish & share" side={desktop === false ? 'bottom' : 'right'}>
        {sharing && <PublishPanel projectId={id} />}
      </Drawer>

      {/* Desktop: files · center · chat (resizable). Only one layout is mounted so polling isn't duplicated. */}
      {desktop === true && <div className="flex min-h-0 flex-1">
        <Group orientation="horizontal" className="min-h-0 flex-1" id="workspace">
          <Panel id="files" defaultSize="18%" minSize="12%" maxSize="32%" className="min-h-0">
            <aside className="flex h-full flex-col bg-bg" aria-label="Files">
              <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle"><ListTree className="size-3.5" />Files{files.data && <span className="ml-auto normal-case tracking-normal">{files.data.length}</span>}</div>
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3"><FileTree files={files.data} loading={files.isLoading} selected={current} onSelect={(p) => { setFile(p); setCenter('code'); }} /></div>
            </aside>
          </Panel>
          <Separator className="w-px bg-border outline-none transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
          <Panel id="center" defaultSize="50%" minSize="30%" className="min-h-0">
            <section className="flex h-full min-w-0 flex-col bg-surface">
              <div className="shrink-0 px-3">
                <Tabs size="sm" value={center} onValueChange={(v) => setCenter(v as Center)} items={[
                  { value: 'code', label: <><Code2 className="size-3.5" />Code</> },
                  { value: 'versions', label: <><History className="size-3.5" />Versions</> },
                  { value: 'logs', label: <><ScrollText className="size-3.5" />Logs</> },
                  { value: 'preview', label: <><Eye className="size-3.5" />Preview</>, disabled: true, badge: <SoonBadge /> },
                ]} />
              </div>
              <div className="min-h-0 flex-1">{center === 'code' ? <CodeView projectId={id} path={current} /> : center === 'versions' ? <Versions projectId={id} busy={!!activeRun} /> : <Logs runs={runs.data} />}</div>
            </section>
          </Panel>
          <Separator className="w-px bg-border outline-none transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
          <Panel id="chat" defaultSize="32%" minSize="24%" maxSize="48%" className="min-h-0">
            <Chat projectId={id} runs={runs.data} activeRun={activeRun} hasFiles={!!files.data?.length} />
          </Panel>
        </Group>
      </div>}

      {/* Mobile: one focused panel at a time */}
      {desktop === false && <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-2">
          <Tabs size="sm" value={mobileTab} onValueChange={(v) => setMobileTab(v as MobileTab)} items={[
            { value: 'chat', label: <><MessageSquare className="size-3.5" />Chat</> },
            { value: 'files', label: <><ListTree className="size-3.5" />Files</> },
            { value: 'code', label: <><Code2 className="size-3.5" />Code</> },
            { value: 'versions', label: <><History className="size-3.5" />Versions</> },
          ]} />
        </div>
        <div className="min-h-0 flex-1">
          {mobileTab === 'chat' ? <Chat projectId={id} runs={runs.data} activeRun={activeRun} hasFiles={!!files.data?.length} />
            : mobileTab === 'files' ? <div className="h-full overflow-y-auto p-2"><FileTree files={files.data} loading={files.isLoading} selected={current} onSelect={(p) => { setFile(p); setMobileTab('code'); }} /></div>
            : mobileTab === 'code' ? <CodeView projectId={id} path={current} />
            : <Versions projectId={id} busy={!!activeRun} />}
        </div>
      </div>}
    </div>
  );
}

function useIsDesktop() {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => setV(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return v;
}

// ───────── Files ─────────

interface TreeNode { name: string; path: string; children: Map<string, TreeNode>; file: boolean }

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), file: false };
  for (const p of paths) {
    let node = root;
    p.split('/').forEach((part, i, arr) => {
      if (!node.children.has(part)) node.children.set(part, { name: part, path: arr.slice(0, i + 1).join('/'), children: new Map(), file: i === arr.length - 1 });
      node = node.children.get(part)!;
    });
  }
  return root;
}

function FileTree({ files, loading, selected, onSelect }: { files?: { path: string }[]; loading: boolean; selected: string | null; onSelect: (p: string) => void }) {
  const tree = useMemo(() => buildTree((files ?? []).map((f) => f.path)), [files]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  if (loading) return <div className="space-y-2 p-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5" />)}</div>;
  if (!files?.length) return <EmptyState compact icon={<FileText className="size-4" />} title="No files yet" body="Files appear after the first generation." />;
  const toggle = (path: string) => setClosed((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const render = (n: TreeNode, depth: number): React.ReactNode[] =>
    [...n.children.values()]
      .sort((a, b) => (a.file === b.file ? a.name.localeCompare(b.name) : a.file ? 1 : -1))
      .flatMap((c) => {
        const pad = { paddingLeft: 8 + depth * 14 };
        if (c.file) {
          return [<button key={c.path} onClick={() => onSelect(c.path)} style={pad} title={c.path} aria-current={c.path === selected ? 'true' : undefined} className={cx('flex h-8 w-full items-center gap-2 truncate rounded-[var(--radius-sm)] pr-2 text-left font-mono text-[12.5px] transition-colors md:h-7', c.path === selected ? 'bg-surface-muted text-fg' : 'text-muted hover:bg-surface-muted/70 hover:text-fg')}><FileCode2 className="size-3.5 shrink-0 opacity-70" /><span className="truncate">{c.name}</span></button>];
        }
        const open = !closed.has(c.path);
        return [
          <button key={c.path} onClick={() => toggle(c.path)} style={pad} aria-expanded={open} className="flex h-8 w-full items-center gap-1.5 rounded-[var(--radius-sm)] pr-2 text-left text-[12.5px] font-medium text-fg hover:bg-surface-muted/70 md:h-7">
            <ChevronRight className={cx('size-3.5 shrink-0 text-subtle transition-transform', open && 'rotate-90')} /><Folder className="size-3.5 shrink-0 text-subtle" />{c.name}
          </button>,
          ...(open ? render(c, depth + 1) : []),
        ];
      });
  return <nav aria-label="Project files">{render(tree, 0)}</nav>;
}

function CodeView({ projectId, path }: { projectId: string; path: string | null }) {
  const file = useQuery({ queryKey: ['file', projectId, path], queryFn: () => api.file(projectId, path!), enabled: !!path });
  if (!path) return <EmptyState icon={<FileCode2 className="size-5" />} title="Nothing to show yet" body="Your project's code appears here after the first generation." />;
  const lines = (file.data?.content ?? '').split('\n');
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 font-mono text-xs text-muted"><FileCode2 className="size-3.5 shrink-0" /><span className="truncate">{path}</span></div>
      {file.error ? <div className="p-4"><ErrorNotice error={file.error} /></div> : !file.data ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-4" />)}</div> : file.data.content === null ? (
        <EmptyState compact title="Binary file" body="This file can't be shown as text." />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface-sunken/40">
          <pre className="min-w-max py-3 font-mono text-[12.5px] leading-[1.65]"><code>{lines.map((l, i) => <div key={i} className="flex"><span className="w-12 shrink-0 select-none pr-4 text-right text-subtle/70">{i + 1}</span><span className="pr-6">{l || ' '}</span></div>)}</code></pre>
        </div>
      )}
    </div>
  );
}

// ───────── Versions & logs ─────────

function Versions({ projectId, busy }: { projectId: string; busy: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const versions = useQuery({ queryKey: ['versions', projectId], queryFn: () => api.versions(projectId) });
  const restore = useMutation({
    mutationFn: (vid: string) => api.restore(projectId, vid),
    onSuccess: () => { for (const k of ['versions', 'files', 'file']) void qc.invalidateQueries({ queryKey: [k, projectId] }); toast.success('Restored as a new version'); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (versions.error) return <div className="p-4"><ErrorNotice error={versions.error} onRetry={() => void versions.refetch()} /></div>;
  if (!versions.data) return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!versions.data.length) return <EmptyState icon={<History className="size-5" />} title="No versions yet" body="Every successful generation or edit is saved as a version you can restore." />;
  return (
    <ol className="h-full overflow-y-auto p-3">
      {versions.data.map((v, i) => (
        <li key={v.id} className="relative flex gap-3 pb-4 pl-1">
          {i < versions.data.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-px bg-border" aria-hidden />}
          <span className={cx('z-10 mt-1 flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold', v.isHead ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-muted')}>{v.number}</span>
          <div className="min-w-0 flex-1 px-1 py-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 break-words text-sm font-medium">{v.message}</div>
              {v.isHead ? <Badge tone="success">Current</Badge> : (
                <Button size="xs" variant="secondary" disabled={busy || restore.isPending} loading={restore.isPending && restore.variables === v.id} onClick={async () => {
                  const r = await confirm({ title: `Restore version ${v.number}?`, body: 'Your current code stays in history — restoring creates a new version with this content.', confirmLabel: 'Restore' });
                  if (r.ok) restore.mutate(v.id);
                }}><RotateCcw className="size-3" />Restore</Button>
              )}
            </div>
            <div className="mt-0.5 text-xs text-subtle">{timeAgo(v.createdAt)} · <span className="font-mono">{v.commitSha.slice(0, 7)}</span></div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Logs({ runs }: { runs?: Run[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runs) return <div className="p-4"><Skeleton className="h-24" /></div>;
  if (!runs.length) return <EmptyState icon={<ScrollText className="size-5" />} title="No runs yet" body="Each AI run's step-by-step log appears here." />;
  return (
    <div className="h-full overflow-y-auto">
      {runs.map((r) => (
        <div key={r.id} className="border-b border-border">
          <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted/60" aria-expanded={open === r.id}>
            <ChevronRight className={cx('size-3.5 shrink-0 text-subtle transition-transform', open === r.id && 'rotate-90')} />
            <span className="min-w-0 flex-1 truncate text-sm">{r.prompt}</span>
            <span className="shrink-0 text-xs text-subtle">{timeAgo(r.createdAt)}</span>
            <StatusBadge status={r.status} />
          </button>
          {open === r.id && <RunLog run={r} />}
        </div>
      ))}
    </div>
  );
}

function RunLog({ run }: { run: Run }) {
  const events = useRunEvents(run.id, ACTIVE.has(run.status));
  return (
    <ol className="space-y-1 bg-surface-sunken/40 px-4 py-3 font-mono text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className="shrink-0 text-subtle">{new Date(e.createdAt).toLocaleTimeString()}</span>
          <span className={cx('w-16 shrink-0', e.type.endsWith('failed') ? 'text-danger' : 'text-muted')}>{e.agent ?? 'run'}</span>
          <span className="min-w-0 break-words">{e.message}</span>
        </li>
      ))}
      {!events.length && <li className="text-subtle">No events recorded.</li>}
      {run.error && <li className="whitespace-pre-wrap text-danger">{run.error}</li>}
    </ol>
  );
}

// ───────── Chat ─────────

function Chat({ projectId, runs, activeRun, hasFiles }: { projectId: string; runs?: Run[]; activeRun?: Run; hasFiles: boolean }) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const latestPlan = !hasFiles ? runs?.find((r) => r.kind === 'plan' && r.status === 'succeeded' && r.plan) : undefined;
  const send = useMutation({
    // Before any code exists, a message after a plan revises the plan; otherwise it builds or edits.
    mutationFn: () => latestPlan ? api.generate(projectId, `${latestPlan.prompt}\n\nChanges to the plan: ${prompt.trim()}`.slice(0, 8000), { mode: 'plan' }) : api.generate(projectId, prompt.trim()),
    onSuccess: () => { setPrompt(''); void qc.invalidateQueries({ queryKey: ['runs', projectId] }); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 402 ? `${e.message} — see Billing to top up or upgrade.` : (e as Error).message),
  });
  const ordered = useMemo(() => [...(runs ?? [])].reverse(), [runs]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [ordered.length]);
  const canSend = !activeRun && prompt.trim().length >= 3 && !send.isPending;
  const hasVersion = hasFiles || runs?.some((r) => r.status === 'succeeded' && r.kind !== 'plan');

  return (
    <section className="flex h-full flex-col bg-bg" aria-label="AI chat">
      <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {!runs ? <Skeleton className="h-24" /> : !ordered.length ? (
          hasVersion
            ? <EmptyState icon={<MessageSquare className="size-5" />} title="Your project is ready to edit" body="Ask for changes in plain language — “Change the hero to our own headline”, “Add a contact page”. Each change is saved as a new version." />
            : <EmptyState icon={<MessageSquare className="size-5" />} title="Describe what to build" body="Your first message generates the project. After that, ask for changes in plain language." />
        ) : ordered.map((r) => <RunTurn key={r.id} run={r} live={r.id === activeRun?.id} actionable={r.id === latestPlan?.id && !activeRun} />)}
        <Approvals projectId={projectId} />
      </div>
      <form className="shrink-0 border-t border-border bg-bg p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" onSubmit={(e) => { e.preventDefault(); if (canSend) send.mutate(); }}>
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm transition-colors focus-within:border-border-strong">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) send.mutate(); } }}
            rows={2}
            disabled={!!activeRun}
            aria-label="Message the AI"
            placeholder={activeRun ? 'AI is working on your last request…' : hasVersion ? 'Ask for a change — "Make the hero more premium"' : latestPlan ? 'Suggest changes to the plan…' : 'Describe your project'}
            className="block w-full resize-none bg-transparent px-3.5 pt-3 text-sm outline-none placeholder:text-subtle disabled:opacity-60"
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            <VoiceButton size="xs" onText={(t) => setPrompt((v) => (v.trim() ? `${v.trimEnd()} ${t}` : t))} />
            <span className="hidden text-xs text-subtle sm:inline"><Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> new line</span>
            <Button type="submit" size="sm" iconOnly className="ml-auto" disabled={!canSend} loading={send.isPending} aria-label="Send"><ArrowUp className="size-4" /></Button>
          </div>
        </div>
      </form>
    </section>
  );
}

interface Changes { created: string[]; updated: string[]; deleted: string[] }
const after = (a: string, b: string) => BigInt(a) > BigInt(b);

function summarize(events: RunEvent[]) {
  const steps = events.filter((e) => e.type === 'step.started').map((e) => ({
    ...e,
    done: events.some((x) => after(x.id, e.id) && (x.agent === e.agent ? x.type === 'step.completed' || x.type === 'files.changed' : x.type === 'step.started')),
  }));
  const changes: Changes = { created: [], updated: [], deleted: [] };
  let summary: string | null = null;
  for (const e of events) {
    if (e.type === 'files.changed' && e.agent === 'frontend') {
      const d = (e.data ?? {}) as Partial<Changes>;
      for (const k of ['created', 'updated', 'deleted'] as const) for (const f of d[k] ?? []) if (!changes[k].includes(f)) changes[k].push(f);
      summary = e.message;
    }
  }
  return {
    steps,
    changes,
    summary,
    repairs: events.filter((e) => e.type === 'files.changed' && e.agent === 'qa').length,
    checksPassed: events.some((e) => e.type === 'step.completed' && e.message === 'All checks passed'),
    skipped: events.find((e) => e.type === 'check.skipped'),
    committed: events.find((e) => e.type === 'version.committed'),
  };
}

function RunTurn({ run, live, actionable = false }: { run: Run; live: boolean; actionable?: boolean }) {
  const events = useRunEvents(run.id, live);
  if (run.kind === 'plan' && run.plan && !live) return <PlanTurn run={run} plan={run.plan} actionable={actionable} />;
  const s = summarize(events);
  const changed = s.changes.created.length + s.changes.updated.length + s.changes.deleted.length;
  const headline = live ? (s.steps.at(-1)?.message ?? 'Starting…') : run.status === 'succeeded' ? (s.summary ?? 'Done') : run.status === 'awaiting_approval' ? 'Waiting for your approval' : run.status === 'failed' ? 'This run failed' : 'Queued';
  return (
    <div className="animate-fade-in space-y-2.5">
      <div className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-[var(--radius-lg)] rounded-br-[4px] bg-primary px-3.5 py-2.5 text-sm text-primary-fg shadow-sm">{run.prompt}</div>
      <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3.5 shadow-sm">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">{live ? <Loader2 className="size-4 animate-spin text-accent" /> : run.status === 'succeeded' ? <Check className="size-4 text-success" /> : run.status === 'awaiting_approval' ? <AlertTriangle className="size-4 text-warning" /> : run.status === 'failed' ? <X className="size-4 text-danger" /> : <CircleDashed className="size-4 text-subtle" />}</span>
          <span className="min-w-0 flex-1 text-sm font-medium">{headline}</span>
          {run.creditsUsed > 0 && <span className="shrink-0 text-xs tabular-nums text-subtle">{run.creditsUsed} credits</span>}
        </div>

        {s.steps.length > 0 && (
          <ol className="mt-3 space-y-1.5 border-l border-border pl-3.5" aria-label="Steps">
            {s.steps.map((st) => (
              <li key={st.id} className="flex items-center gap-2 text-[13px] text-muted">
                {st.done || !live ? <Check className={cx('size-3.5 shrink-0', run.status === 'failed' && !st.done ? 'text-danger' : 'text-success')} /> : <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />}{st.message}
              </li>
            ))}
          </ol>
        )}

        {changed > 0 && (
          <details className="mt-3 rounded-[var(--radius-md)] bg-surface-muted/70 px-3 py-2 text-[13px]" open={changed <= 6}>
            <summary className="cursor-pointer select-none font-medium">{changed} file{changed === 1 ? '' : 's'} {run.status === 'awaiting_approval' ? 'proposed' : 'changed'}</summary>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {s.changes.created.map((f) => <li key={`c${f}`} className="flex items-center gap-2 text-success"><FilePlus className="size-3.5 shrink-0" /><span className="truncate">{f}</span></li>)}
              {s.changes.updated.map((f) => <li key={`u${f}`} className="flex items-center gap-2 text-muted"><FileCode2 className="size-3.5 shrink-0" /><span className="truncate">{f}</span></li>)}
              {s.changes.deleted.map((f) => <li key={`d${f}`} className="flex items-center gap-2 text-danger"><FileMinus className="size-3.5 shrink-0" /><span className="truncate">{f}</span></li>)}
            </ul>
          </details>
        )}

        {!live && (s.checksPassed || s.repairs > 0 || s.committed) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {s.checksPassed && (s.skipped
              ? <Tooltip content={s.skipped.message}><span tabIndex={0}><Badge tone="success">Static checks passed · build check skipped</Badge></span></Tooltip>
              : <Badge tone="success">Checks passed</Badge>)}
            {s.repairs > 0 && <Badge tone="warning">{s.repairs} auto-repair{s.repairs === 1 ? '' : 's'}</Badge>}
            {s.committed && <Badge>{s.committed.message}</Badge>}
          </div>
        )}
        {run.error && <p className="mt-3 whitespace-pre-wrap break-words text-[13px] text-danger">{run.error}</p>}
      </div>
    </div>
  );
}

function Approvals({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const approvals = useQuery({ queryKey: ['approvals', projectId], queryFn: () => api.approvals(projectId) });
  const decide = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => api.decide(id, ok),
    onSuccess: (r) => {
      if (r.status === 'applied') toast.success('Change applied');
      else if (r.status === 'rejected') toast.message('Change discarded');
      else toast.error(r.error ?? 'Could not apply the change');
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => { for (const k of ['approvals', 'files', 'versions', 'runs', 'file']) void qc.invalidateQueries({ queryKey: [k, projectId] }); },
  });
  const pending = approvals.data?.filter((a) => a.status === 'pending') ?? [];
  return (
    <>
      {pending.map((a) => (
        <div key={a.id} className="animate-fade-in rounded-[var(--radius-lg)] border border-warning/30 bg-warning-soft p-4" role="status">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning"><AlertTriangle className="size-4" />Needs your attention</div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] text-fg/80">{a.summary}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => decide.mutate({ id: a.id, ok: true })} disabled={decide.isPending} loading={decide.isPending && decide.variables?.ok === true}>Apply change</Button>
            <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: a.id, ok: false })} disabled={decide.isPending}>Discard</Button>
          </div>
        </div>
      ))}
    </>
  );
}

// ───────── Plan-first ─────────

function PlanTurn({ run, plan, actionable }: { run: Run; plan: PlanDraft; actionable: boolean }) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const build = useMutation({
    mutationFn: () => {
      const text = plan.questions.filter((q) => answers[q.id]?.trim()).map((q) => `${q.question} ${answers[q.id]!.trim()}`).join('\n');
      return api.generate(run.projectId, run.prompt.split('\n\nChanges to the plan:')[0]!.slice(0, 8000), { planRunId: run.id, answers: text });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs', run.projectId] }); toast.success('Building your project from the plan'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const s = plan.spec;
  const needsKeys = s.integrations.filter((i) => i.requiresCustomerConfig);
  return (
    <div className="animate-fade-in space-y-2.5">
      <div className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-[var(--radius-lg)] rounded-br-[4px] bg-primary px-3.5 py-2.5 text-sm text-primary-fg shadow-sm">{run.prompt.includes('\n\nChanges to the plan: ') ? run.prompt.split('\n\nChanges to the plan: ')[1] : run.prompt}</div>
      <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm">
        <div className="flex items-start gap-2">
          <ListChecks className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1"><div className="text-sm font-semibold">Plan: {s.name}</div><p className="mt-1 text-[13px] text-muted">{s.summary}</p></div>
          {run.creditsUsed > 0 && <span className="shrink-0 text-xs tabular-nums text-subtle">{run.creditsUsed} credits</span>}
        </div>
        <div className="mt-3 space-y-3 text-[13px]">
          {s.audience && <p><span className="font-medium">For: </span><span className="text-muted">{s.audience}</span></p>}
          <div>
            <div className="font-medium">Pages ({s.pages.length})</div>
            <ul className="mt-1.5 space-y-1">{s.pages.map((p) => <li key={p.route} className="flex gap-2"><span className="w-24 shrink-0 truncate font-mono text-xs text-subtle">{p.route}</span><span><span className="font-medium">{p.title}</span> <span className="text-muted">— {p.purpose}</span></span></li>)}</ul>
          </div>
          {s.entities.length > 0 && <p><span className="font-medium">Data: </span><span className="text-muted">{s.entities.map((e) => e.name).join(', ')}</span></p>}
          {needsKeys.length > 0 && <p className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-warning">Needs your own account later: {needsKeys.map((i) => i.name).join(', ')}</p>}
          {plan.assumptions.length > 0 && <div><div className="font-medium">Assumptions</div><ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{plan.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>}
        </div>
        {actionable && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {plan.questions.length > 0 && (
              <div className="space-y-3">
                <div className="text-[13px] font-medium">A few questions <span className="font-normal text-muted">(optional — skip any)</span></div>
                {plan.questions.map((q) => (
                  <label key={q.id} className="block">
                    <span className="text-[13px]">{q.question}</span>
                    <span className="block text-xs text-subtle">{q.why}</span>
                    <Textarea rows={2} className="mt-1.5" value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => build.mutate()} loading={build.isPending}><Hammer className="size-3.5" />Build this plan</Button>
              <span className="text-xs text-subtle">Or describe changes below to revise the plan.</span>
            </div>
          </div>
        )}
        {!actionable && run.status === 'succeeded' && <p className="mt-3 text-xs text-subtle">Plan reviewed.</p>}
      </div>
    </div>
  );
}
