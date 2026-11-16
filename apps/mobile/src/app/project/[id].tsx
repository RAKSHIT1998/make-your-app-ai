import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TYPE_META } from '@/components/bits';
import {
  Badge, Body, Button, Caption, Card, Chip, EmptyState, ErrorState, ErrorText, Field, Group, H2, H3, Icon, IconButton, ListRow, Loading, Muted, Overline,
  Row, Screen, Segmented, Sheet, SkeletonCards, StatusBadge, ToggleRow, confirmAction, toast,
} from '@/components/ui';
import { api, CATEGORIES, CATEGORY_LABELS, showcase, WEB_URL, type Category, type PlanDraft, type Run, type RunEvent } from '@/lib/api';
import { ago, dateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

const ACTIVE = new Set(['queued', 'running']);
type Tab = 'chat' | 'files' | 'versions' | 'share';
const PLAN_CHANGES = '\n\nChanges to the plan: ';

export default function Workspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('chat');
  const [menu, setMenu] = useState(false);
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
  const runs = useQuery({ queryKey: ['runs', id], queryFn: () => api.runs(id), refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE.has(r.status)) ? 2000 : false) });
  const active = runs.data?.find((r) => ACTIVE.has(r.status));

  const wasActive = useRef<Run | undefined>(undefined);
  useEffect(() => {
    const prev = wasActive.current;
    if (prev && !active) {
      for (const k of ['project', 'files', 'versions', 'approvals', 'publishing']) void qc.invalidateQueries({ queryKey: [k, id] });
      for (const k of ['projects', 'activity', 'billing', 'credits', 'achievements']) void qc.invalidateQueries({ queryKey: [k] });
      const done = runs.data?.find((r) => r.id === prev.id);
      if (done?.status === 'succeeded') toast.success(done.kind === 'plan' ? 'Your plan is ready' : done.kind === 'ask' ? 'Answered' : 'Done. A new version is saved.');
      else if (done?.status === 'failed') toast.error(done.creditsRefunded ? 'That run failed. Its credits were refunded.' : 'That run failed.');
    }
    wasActive.current = active;
  }, [active, qc, id, runs.data]);

  if (project.error) return <Screen><View style={{ padding: 20 }}><ErrorState error={project.error} onRetry={() => void project.refetch()} /></View></Screen>;
  const p = project.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: p?.name ?? '', headerRight: () => <IconButton icon="more-horizontal" label="Project actions" onPress={() => setMenu(true)} /> }} />
      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 10 }}>
        {p ? (
          <Row gap={8}>
            <Badge label={TYPE_META[p.type]?.label ?? p.type} icon={TYPE_META[p.type]?.icon} />
            <StatusBadge status={active ? 'running' : p.status} />
          </Row>
        ) : null}
        <Segmented label="Project sections" value={tab} onChange={setTab} options={[{ value: 'chat', label: 'Chat' }, { value: 'files', label: 'Files' }, { value: 'versions', label: 'Versions' }, { value: 'share', label: 'Share' }]} />
      </View>
      {tab === 'chat' ? <Chat projectId={id} runs={runs.data} runsError={runs.error} active={active} /> : tab === 'files' ? <Files projectId={id} /> : tab === 'versions' ? <Versions projectId={id} busy={!!active} /> : <SharePanel projectId={id} />}
      {p ? <ProjectMenu open={menu} onClose={() => setMenu(false)} projectId={id} name={p.name} archived={p.status === 'archived'} /> : null}
    </Screen>
  );
}

// ───────── Chat ─────────
function Chat({ projectId, runs, runsError, active }: { projectId: string; runs: Run[] | undefined; runsError: unknown; active: Run | undefined }) {
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'build' | 'ask'>('build');
  const ordered = useMemo(() => [...(runs ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [runs]);
  const hasVersion = ordered.some((r) => r.status === 'succeeded' && r.kind !== 'plan' && r.kind !== 'ask');
  const latestPlan = !hasVersion ? ([...ordered].reverse().find((r) => r.kind === 'plan' && r.status === 'succeeded' && r.plan && 'spec' in r.plan) as (Run & { plan: PlanDraft }) | undefined) : undefined;
  const asking = mode === 'ask' && hasVersion;

  const send = useMutation({
    mutationFn: () => {
      const text = prompt.trim();
      if (asking) return api.generate(projectId, text, { mode: 'ask' });
      // Before any code exists, a message after a plan revises the plan.
      if (latestPlan) return api.generate(projectId, `${latestPlan.prompt.split(PLAN_CHANGES)[0]}${PLAN_CHANGES}${text}`.slice(0, 8000), { mode: 'plan' });
      return api.generate(projectId, text);
    },
    onSuccess: () => {
      setPrompt('');
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 18 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
        {runsError ? <ErrorState error={runsError} /> : !runs ? <SkeletonCards count={2} height={90} /> : ordered.length === 0 ? (
          <Card><EmptyState icon="message-circle" title="Describe what to build" body="Write your idea below. After the first version, ask for changes in plain language." /></Card>
        ) : ordered.map((r) => <Turn key={r.id} run={r} live={r.id === active?.id} actionablePlan={r.id === latestPlan?.id && !active} onUseSuggestion={(t) => { setMode('build'); setPrompt(t); }} />)}
        <Approvals projectId={projectId} />
      </ScrollView>
      <View style={{ padding: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface, gap: 8 }}>
        {hasVersion ? (
          <Row gap={8}>
            <Chip label="Change" icon="edit-3" selected={mode === 'build'} onPress={() => setMode('build')} />
            <Chip label="Ask" icon="help-circle" selected={mode === 'ask'} onPress={() => setMode('ask')} />
            <Caption style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>{asking ? 'Nothing will be changed' : ''}</Caption>
          </Row>
        ) : null}
        <Row gap={8} style={{ alignItems: 'flex-end' }}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            editable={!active}
            multiline
            maxLength={8000}
            accessibilityLabel="Message"
            placeholder={active ? 'Working on your last request…' : asking ? 'Ask about this project' : hasVersion ? 'Ask for a change' : latestPlan ? 'Describe changes to the plan' : 'Describe what to build'}
            placeholderTextColor={c.textSubtle}
            style={{ flex: 1, minHeight: 46, maxHeight: 140, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: c.text, fontSize: 16, backgroundColor: c.bg }}
          />
          <Pressable onPress={() => send.mutate()} disabled={!!active || prompt.trim().length < 3 || send.isPending} accessibilityRole="button" accessibilityLabel="Send"
            style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, opacity: !!active || prompt.trim().length < 3 ? 0.35 : 1 }}>
            <Icon name="arrow-up" color={c.primaryFg} size={20} />
          </Pressable>
        </Row>
        <ErrorText error={send.error} />
      </View>
    </KeyboardAvoidingView>
  );
}

function UserBubble({ text }: { text: string }) {
  const { c, radius } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.primary, borderRadius: radius.xl, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
      <Text selectable style={{ color: c.primaryFg, fontSize: 15, lineHeight: 21 }}>{text}</Text>
    </View>
  );
}

function useEvents(runId: string, live: boolean, enabled: boolean) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const after = useRef('0');
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.events(runId, after.current);
        if (next.length) {
          after.current = next[next.length - 1]!.id;
          setEvents((e) => [...e, ...next]);
        }
      } catch {
        /* next tick */
      }
      if (!stop && live) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [runId, live, enabled]);
  return events;
}

function Turn({ run, live, actionablePlan, onUseSuggestion }: { run: Run; live: boolean; actionablePlan: boolean; onUseSuggestion: (t: string) => void }) {
  const { c, radius } = useTheme();
  const [showSteps, setShowSteps] = useState(false);
  const events = useEvents(run.id, live, live || showSteps);
  const userText = run.prompt.includes(PLAN_CHANGES) ? run.prompt.split(PLAN_CHANGES)[1]! : run.kind === 'create' && run.fromPlanId ? 'Build this plan' : run.prompt;

  if (run.kind === 'plan' && run.status === 'succeeded' && run.plan && 'spec' in run.plan) {
    return (<View style={{ gap: 10 }}><UserBubble text={userText} /><PlanCard run={run} plan={run.plan} actionable={actionablePlan} /></View>);
  }
  const suggested = run.kind === 'ask' && run.plan && 'suggestedPrompt' in run.plan ? run.plan.suggestedPrompt : null;
  const visible = events.filter((e) => live || !e.type.endsWith('started'));
  return (
    <View style={{ gap: 10 }}>
      <UserBubble text={userText} />
      <View style={{ maxWidth: '94%', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.xl, borderBottomLeftRadius: 6, padding: 14, gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={6}><Overline>{run.kind === 'ask' ? 'Answer' : run.kind === 'plan' ? 'Plan' : run.kind === 'edit' ? 'Change' : 'Build'}</Overline><StatusBadge status={run.status} /></Row>
          <Caption>{run.creditsUsed > 0 ? `${run.creditsUsed} credits` : ago(run.createdAt)}</Caption>
        </Row>
        {run.kind === 'ask' && run.answer ? <Body selectable>{run.answer}</Body> : null}
        {live || showSteps ? visible.slice(-14).map((e) => (
          <Row key={e.id} gap={8} style={{ alignItems: 'flex-start' }}>
            <Icon name={e.type.endsWith('failed') ? 'alert-triangle' : e.type.endsWith('started') ? 'loader' : 'check'} size={14} color={e.type.endsWith('failed') ? c.danger : c.textSubtle} style={{ marginTop: 3 }} />
            <Text style={{ color: e.type.endsWith('failed') ? c.danger : c.textMuted, fontSize: 14, flex: 1, lineHeight: 20 }}>{e.message}</Text>
          </Row>
        )) : null}
        {live && visible.length === 0 ? <Caption>Starting…</Caption> : null}
        {run.error ? <Text style={{ color: c.danger, fontSize: 14, lineHeight: 20 }}>{run.error}</Text> : null}
        {run.creditsRefunded ? <Badge label={`${run.creditsRefunded} credits refunded`} tone="success" icon="rotate-ccw" /> : null}
        {suggested ? <Button title="Use this as a change" size="sm" variant="secondary" icon="corner-down-right" onPress={() => onUseSuggestion(suggested)} style={{ alignSelf: 'flex-start' }} /> : null}
        {!live && run.kind !== 'ask' ? (
          <Pressable onPress={() => setShowSteps((s) => !s)} accessibilityRole="button" hitSlop={8}><Caption style={{ color: c.textMuted, fontWeight: '600' }}>{showSteps ? 'Hide steps' : 'Show steps'}</Caption></Pressable>
        ) : null}
      </View>
    </View>
  );
}

function PlanCard({ run, plan, actionable }: { run: Run; plan: PlanDraft; actionable: boolean }) {
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const build = useMutation({
    mutationFn: () => {
      const text = plan.questions.filter((q) => answers[q.id]?.trim()).map((q) => `${q.question} ${answers[q.id]!.trim()}`).join('\n');
      return api.generate(run.projectId, run.prompt.split(PLAN_CHANGES)[0]!.slice(0, 8000), { planRunId: run.id, answers: text });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs', run.projectId] }); toast.success('Building from your plan'); },
  });
  const s = plan.spec;
  return (
    <View testID="plan-card" style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: actionable ? c.primary : c.border, borderRadius: radius.xl, padding: 16, gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}><Overline>Plan</Overline>{run.creditsUsed ? <Caption>{run.creditsUsed} credits</Caption> : null}</Row>
        <H2>{s.name}</H2>
        <Body muted>{s.summary}</Body>
        {s.audience ? <Caption>For: {s.audience}</Caption> : null}
      </View>
      {s.pages.length ? (
        <View style={{ gap: 6 }}>
          <H3>{s.pages.length === 1 ? 'Page' : `${s.pages.length} pages`}</H3>
          {s.pages.map((p) => (
            <Row key={p.route} gap={10} style={{ alignItems: 'flex-start' }}>
              <Icon name="file" size={14} color={c.textSubtle} style={{ marginTop: 4 }} />
              <View style={{ flex: 1 }}><Body style={{ fontWeight: '600' }}>{p.title} <Text style={{ color: c.textSubtle, fontWeight: '400' }}>{p.route}</Text></Body><Caption>{p.purpose}</Caption></View>
            </Row>
          ))}
        </View>
      ) : null}
      {s.entities.length ? (
        <View style={{ gap: 6 }}>
          <H3>Data</H3>
          {s.entities.map((e) => <Caption key={e.name}><Text style={{ fontWeight: '700', color: c.text }}>{e.name}</Text>: {e.fields.join(', ')}</Caption>)}
        </View>
      ) : null}
      {plan.assumptions.length ? (
        <View style={{ gap: 4 }}>
          <H3>Assumptions</H3>
          {plan.assumptions.map((a) => <Caption key={a}>• {a}</Caption>)}
        </View>
      ) : null}
      {actionable ? (
        <View style={{ gap: 12 }}>
          {plan.questions.length ? <H3>A few questions (optional)</H3> : null}
          {plan.questions.map((q) => (
            <Field key={q.id} label={q.question} hint={q.why} value={answers[q.id] ?? ''} onChangeText={(t) => setAnswers({ ...answers, [q.id]: t })} multiline style={{ minHeight: 70 }} />
          ))}
          <ErrorText error={build.error} />
          <Button title="Build this plan" icon="tool" onPress={() => build.mutate()} loading={build.isPending} full />
          <Caption style={{ textAlign: 'center' }}>Or describe changes below to revise the plan.</Caption>
        </View>
      ) : null}
    </View>
  );
}

function Approvals({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['approvals', projectId], queryFn: () => api.approvals(projectId) });
  const decide = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => api.decide(id, ok),
    onSettled: () => { for (const k of ['approvals', 'files', 'versions', 'runs']) void qc.invalidateQueries({ queryKey: [k, projectId] }); },
  });
  const pending = q.data?.filter((a) => a.status === 'pending') ?? [];
  return (
    <>
      {pending.map((a) => (
        <Card key={a.id} tone="warning" style={{ gap: 10 }}>
          <Row><Icon name="shield" /><H3 style={{ flex: 1 }}>Your approval is needed</H3></Row>
          <Body>{a.summary}</Body>
          <Caption>Expires {ago(a.expiresAt).replace(' ago', '')}</Caption>
          <ErrorText error={decide.error} />
          <Row gap={8}>
            <Button title="Apply" onPress={() => decide.mutate({ id: a.id, ok: true })} loading={decide.isPending && decide.variables?.id === a.id && decide.variables.ok} style={{ flex: 1 }} />
            <Button title="Discard" variant="secondary" onPress={() => decide.mutate({ id: a.id, ok: false })} disabled={decide.isPending} style={{ flex: 1 }} />
          </Row>
        </Card>
      ))}
    </>
  );
}

// ───────── Files ─────────
const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
function Files({ projectId }: { projectId: string }) {
  const { c, radius } = useTheme();
  const files = useQuery({ queryKey: ['files', projectId], queryFn: () => api.files(projectId) });
  const [open, setOpen] = useState<string | null>(null);
  const file = useQuery({ queryKey: ['file', projectId, open], queryFn: () => api.file(projectId, open!), enabled: !!open });
  if (files.error) return <View style={{ padding: 16 }}><ErrorState error={files.error} onRetry={() => void files.refetch()} /></View>;
  if (!files.data) return <View style={{ padding: 16 }}><SkeletonCards count={6} height={44} /></View>;
  if (open) {
    return (
      <View style={{ flex: 1, padding: 16, gap: 10 }}>
        <Row>
          <IconButton icon="chevron-left" label="All files" onPress={() => setOpen(null)} size={40} />
          <Text numberOfLines={1} style={{ flex: 1, color: c.textMuted, fontFamily: mono, fontSize: 13 }}>{open}</Text>
        </Row>
        <ScrollView style={{ flex: 1, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border }}>
          <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
            {file.error ? <ErrorText error={file.error} /> : !file.data ? <Loading /> : (
              <Text selectable style={{ color: c.text, fontFamily: mono, fontSize: 12.5, lineHeight: 19 }}>{file.data.content ?? 'This file is binary and can’t be shown here.'}</Text>
            )}
          </ScrollView>
        </ScrollView>
      </View>
    );
  }
  return (
    <FlatList
      data={files.data}
      keyExtractor={(f) => f.path}
      contentContainerStyle={{ padding: 16, gap: 6, paddingBottom: 40 }}
      ListEmptyComponent={<Card><EmptyState icon="file-text" title="No files yet" body="Files appear once the first build finishes." /></Card>}
      ListHeaderComponent={files.data.length ? <Caption style={{ marginBottom: 4 }}>{files.data.length} files</Caption> : undefined}
      renderItem={({ item }) => (
        <Pressable onPress={() => setOpen(item.path)} accessibilityRole="button" accessibilityLabel={`Open ${item.path}`}
          style={({ pressed }) => ({ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: pressed ? c.surfaceMuted : c.surface, borderWidth: 1, borderColor: c.border })}>
          <Icon name="file" size={15} color={c.textSubtle} />
          <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontFamily: mono, fontSize: 13.5 }}>{item.path}</Text>
          <Caption>{item.sizeBytes < 1024 ? `${item.sizeBytes} B` : `${Math.round(item.sizeBytes / 1024)} KB`}</Caption>
        </Pressable>
      )}
    />
  );
}

// ───────── Versions ─────────
function Versions({ projectId, busy }: { projectId: string; busy: boolean }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['versions', projectId], queryFn: () => api.versions(projectId) });
  const restore = useMutation({
    mutationFn: (vid: string) => api.restore(projectId, vid),
    onSuccess: () => { for (const k of ['versions', 'files', 'publishing']) void qc.invalidateQueries({ queryKey: [k, projectId] }); toast.success('Restored as a new version'); },
  });
  if (q.error) return <View style={{ padding: 16 }}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></View>;
  if (!q.data) return <View style={{ padding: 16 }}><SkeletonCards count={4} /></View>;
  return (
    <FlatList
      data={q.data}
      keyExtractor={(v) => v.id}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      ListHeaderComponent={<ErrorText error={restore.error} />}
      ListEmptyComponent={<Card><EmptyState icon="clock" title="No versions yet" body="Every successful build or change is saved as a version you can go back to." /></Card>}
      renderItem={({ item: v }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ color: c.text, fontWeight: '700', width: 34 }}>v{v.number}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Body numberOfLines={2}>{v.message}</Body>
            <Caption>{dateTime(v.createdAt)}</Caption>
          </View>
          {v.isHead ? <Badge label="Current" tone="success" /> : (
            <Button title="Restore" size="sm" variant="secondary" disabled={busy} loading={restore.isPending && restore.variables === v.id}
              onPress={async () => { if (await confirmAction({ title: `Restore version ${v.number}?`, body: 'Its files become the newest version. Nothing is deleted: the current version stays in the history.', confirm: 'Restore' })) restore.mutate(v.id); }} />
          )}
        </Card>
      )}
    />
  );
}

// ───────── Share (publishing) ─────────
function SharePanel({ projectId }: { projectId: string }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['publishing', projectId], queryFn: () => showcase.publishing(projectId) });
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [allowRemix, setAllowRemix] = useState(true);
  useEffect(() => {
    if (!q.data) return;
    setTitle(q.data.publicTitle); setDesc(q.data.publicDescription); setCategory(q.data.category); setAllowRemix(q.data.allowRemix);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (visibility: 'public' | 'private') => showcase.publish(projectId, { visibility, publicTitle: title.trim(), publicDescription: desc.trim(), category, allowRemix }),
    onSuccess: (d) => {
      qc.setQueryData(['publishing', projectId], d);
      void qc.invalidateQueries({ queryKey: ['achievements'] });
      toast.success(d.visibility === 'public' ? 'Published' : 'Now private');
    },
  });
  if (q.error) return <View style={{ padding: 16 }}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></View>;
  const d = q.data;
  if (!d) return <View style={{ padding: 16 }}><SkeletonCards count={3} /></View>;
  const url = d.slug && WEB_URL ? `${WEB_URL}/p/${d.slug}` : null;
  const isPublic = d.visibility === 'public';
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {!d.hasVersion ? <Card><EmptyState icon="send" title="Nothing to share yet" body="Build the first version, then publish it to a public page others can see, like and remix." /></Card> : (
        <>
          <Card tone={isPublic ? 'success' : undefined}>
            <Row><Icon name={isPublic ? 'globe' : 'lock'} /><H3 style={{ flex: 1 }}>{isPublic ? 'Public' : 'Private'}</H3></Row>
            <Muted>{isPublic ? `Anyone with the link can see the published version${d.publishedAt ? ` (published ${ago(d.publishedAt)})` : ''}. Later edits stay private until you publish again.` : 'Only your workspace can see this project.'}</Muted>
            {d.moderated ? <Text style={{ color: c.danger }}>Hidden by moderation{d.moderationNote ? `: ${d.moderationNote}` : '.'}</Text> : null}
            {isPublic && d.outdated ? <Badge label="You have newer changes than the public version" tone="warning" /> : null}
            {isPublic && url ? (
              <Row gap={8} wrap>
                <Button title="Share link" icon="share-2" size="sm" onPress={() => void Share.share({ message: `${d.publicTitle} — ${url}`, url })} />
                <Button title="Open" icon="external-link" size="sm" variant="secondary" onPress={() => void Linking.openURL(url)} />
              </Row>
            ) : null}
          </Card>
          <Field label="Public title" value={title} onChangeText={setTitle} maxLength={80} />
          <Field label="Description" value={desc} onChangeText={setDesc} multiline maxLength={500} style={{ minHeight: 90 }} />
          <View style={{ gap: 8 }}>
            <Overline>Category</Overline>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {CATEGORIES.map((k) => <Chip key={k} label={CATEGORY_LABELS[k]} selected={category === k} onPress={() => setCategory(category === k ? null : k)} />)}
            </ScrollView>
          </View>
          <Card style={{ paddingVertical: 4 }}><ToggleRow label="Allow remixes" hint="Others can start their own copy of the published version. Secrets are never copied." value={allowRemix} onChange={setAllowRemix} /></Card>
          <ErrorText error={save.error} />
          <Button title={isPublic ? (d.outdated ? 'Publish latest version' : 'Update public page') : 'Publish'} icon="send" onPress={() => save.mutate('public')} loading={save.isPending && save.variables === 'public'} disabled={title.trim().length < 2} full />
          {isPublic ? <Button title="Make private" variant="ghost" onPress={async () => { if (await confirmAction({ title: 'Make this private?', body: 'The public page goes offline. Likes and remixes already made are kept.', confirm: 'Make private' })) save.mutate('private'); }} full /> : null}
        </>
      )}
    </ScrollView>
  );
}

// ───────── Project actions ─────────
function ProjectMenu({ open, onClose, projectId, name, archived }: { open: boolean; onClose: () => void; projectId: string; name: string; archived: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [rename, setRename] = useState<string | null>(null);
  const refresh = () => { for (const k of ['projects', 'activity']) void qc.invalidateQueries({ queryKey: [k] }); void qc.invalidateQueries({ queryKey: ['project', projectId] }); };
  const act = useMutation({
    mutationFn: async (a: 'rename' | 'archive' | 'restore' | 'delete') => {
      if (a === 'rename') return api.renameProject(projectId, rename!.trim());
      if (a === 'archive') return api.archiveProject(projectId);
      if (a === 'restore') return api.restoreProject(projectId);
      return api.deleteProject(projectId);
    },
    onSuccess: (_d, a) => {
      refresh();
      setRename(null);
      onClose();
      if (a === 'delete') { toast.success('Project deleted'); router.back(); }
      else toast.success(a === 'rename' ? 'Renamed' : a === 'archive' ? 'Archived' : 'Restored');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'That didn’t work.'),
  });
  return (
    <Sheet open={open} onClose={() => { setRename(null); onClose(); }} title={name}>
      {rename !== null ? (
        <>
          <Field label="Project name" value={rename} onChangeText={setRename} maxLength={80} autoFocus />
          <Button title="Save name" onPress={() => act.mutate('rename')} loading={act.isPending} disabled={!rename.trim()} full />
        </>
      ) : (
        <Group>
          <ListRow icon="edit-2" title="Rename" onPress={() => setRename(name)} chevron={false} />
          {WEB_URL ? <ListRow icon="monitor" title="Open in the web builder" subtitle="Live preview, data, dashboard and deploys" onPress={() => void Linking.openURL(`${WEB_URL}/projects/${projectId}`)} chevron={false} /> : null}
          {archived
            ? <ListRow icon="rotate-ccw" title="Restore from archive" onPress={() => act.mutate('restore')} chevron={false} />
            : <ListRow icon="archive" title="Archive" subtitle="Hides it from your list and takes it offline. You can restore it." onPress={async () => { onClose(); if (await confirmAction({ title: 'Archive this project?', body: 'It is taken offline and moved to Archived. You can restore it later.', confirm: 'Archive' })) act.mutate('archive'); }} chevron={false} />}
          <ListRow icon="trash-2" title="Delete project" destructive chevron={false}
            onPress={async () => { onClose(); if (await confirmAction({ title: `Delete “${name}”?`, body: 'The project, its files and its public page are removed. This can’t be undone.', confirm: 'Delete project', destructive: true })) act.mutate('delete'); }} />
        </Group>
      )}
    </Sheet>
  );
}
