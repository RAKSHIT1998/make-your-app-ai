import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Card, ErrorText, Loading, Screen, StatusBadge } from '@/components/ui';
import { api, type Run, type RunEvent } from '@/lib/api';
import { useTheme } from '@/lib/theme';

const ACTIVE = new Set(['queued', 'running']);
type Tab = 'chat' | 'files' | 'versions';

export default function Workspace() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Redirect href="/login" />;
  return <WorkspaceScreen />;
}

function WorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius } = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('chat');
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
  const runs = useQuery({ queryKey: ['runs', id], queryFn: () => api.runs(id), refetchInterval: (q) => (q.state.data?.some((r) => ACTIVE.has(r.status)) ? 2000 : false) });
  const active = runs.data?.find((r) => ACTIVE.has(r.status));

  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) for (const k of ['project', 'files', 'versions', 'approvals']) void qc.invalidateQueries({ queryKey: [k, id] });
    wasActive.current = !!active;
  }, [active, qc, id]);

  return (
    <Screen>
      <Stack.Screen options={{ title: project.data?.name ?? 'Project', headerRight: () => (project.data ? <StatusBadge status={project.data.status} /> : null) }} />
      <View style={{ flexDirection: 'row', margin: 16, marginBottom: 8, padding: 4, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }} accessibilityRole="tablist">
        {(['chat', 'files', 'versions'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} style={{ flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: tab === t ? c.brandSoft : 'transparent' }}>
            <Text style={{ color: tab === t ? c.brand : c.textMuted, fontWeight: '600', textTransform: 'capitalize' }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'chat' ? <Chat projectId={id} runs={runs.data} active={active} /> : tab === 'files' ? <Files projectId={id} /> : <Versions projectId={id} busy={!!active} />}
    </Screen>
  );
}

function Chat({ projectId, runs, active }: { projectId: string; runs: Run[] | undefined; active: Run | undefined }) {
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const send = useMutation({
    mutationFn: () => api.generate(projectId, prompt.trim()),
    onSuccess: () => {
      setPrompt('');
      void qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
  });
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {!runs ? <Loading /> : runs.length === 0 ? <Card><Body muted>Describe your project to generate it. After that, ask for changes in plain language.</Body></Card> : [...runs].reverse().map((r) => <RunBubble key={r.id} run={r} live={r.id === active?.id} />)}
        <Approvals projectId={projectId} />
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          editable={!active}
          multiline
          accessibilityLabel="Message"
          placeholder={active ? 'Working on your request…' : 'Ask for a change'}
          placeholderTextColor={c.textSubtle}
          style={{ flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 16 }}
        />
        <Button title="Send" onPress={() => send.mutate()} loading={send.isPending} disabled={!!active || prompt.trim().length < 3} />
      </View>
      {send.error ? <View style={{ paddingHorizontal: 16 }}><ErrorText error={send.error} /></View> : null}
    </KeyboardAvoidingView>
  );
}

function RunBubble({ run, live }: { run: Run; live: boolean }) {
  const { c, radius } = useTheme();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const after = useRef('0');
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const next = await api.events(run.id, after.current);
        if (next.length) {
          after.current = next[next.length - 1]!.id;
          setEvents((e) => [...e, ...next]);
        }
      } catch {
        /* retry next tick */
      }
      if (!stop && live) setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [run.id, live]);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: c.brand, borderRadius: radius.lg, padding: 12 }}>
        <Text style={{ color: c.brandFg, fontSize: 15 }}>{run.prompt}</Text>
      </View>
      <View style={{ maxWidth: '92%', backgroundColor: c.surfaceMuted, borderRadius: radius.lg, padding: 12, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <StatusBadge status={run.status} />
          {run.creditsUsed > 0 && <Text style={{ color: c.textSubtle, fontSize: 12 }}>{run.creditsUsed} credits</Text>}
        </View>
        {events.filter((e) => !e.type.endsWith('started') || live).map((e) => (
          <Text key={e.id} style={{ color: e.type.endsWith('failed') ? c.danger : c.textMuted, fontSize: 14 }}>{e.type.endsWith('failed') ? '⚠︎ ' : '✓ '}{e.message}</Text>
        ))}
        {run.error && <Text style={{ color: c.danger, fontSize: 14 }}>{run.error}</Text>}
      </View>
    </View>
  );
}

function Approvals({ projectId }: { projectId: string }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['approvals', projectId], queryFn: () => api.approvals(projectId) });
  const decide = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => api.decide(id, ok),
    onSettled: () => {
      for (const k of ['approvals', 'files', 'versions', 'runs']) void qc.invalidateQueries({ queryKey: [k, projectId] });
    },
  });
  return (
    <>
      {q.data?.filter((a) => a.status === 'pending').map((a) => (
        <Card key={a.id} style={{ gap: 10, borderColor: c.warning }}>
          <Text style={{ color: c.warning, fontWeight: '700' }}>Approval needed</Text>
          <Body muted>{a.summary}</Body>
          <ErrorText error={decide.error} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title="Apply" onPress={() => decide.mutate({ id: a.id, ok: true })} loading={decide.isPending} /></View>
            <View style={{ flex: 1 }}><Button title="Discard" variant="secondary" onPress={() => decide.mutate({ id: a.id, ok: false })} disabled={decide.isPending} /></View>
          </View>
        </Card>
      ))}
    </>
  );
}

function Files({ projectId }: { projectId: string }) {
  const { c, radius } = useTheme();
  const files = useQuery({ queryKey: ['files', projectId], queryFn: () => api.files(projectId) });
  const [open, setOpen] = useState<string | null>(null);
  const file = useQuery({ queryKey: ['file', projectId, open], queryFn: () => api.file(projectId, open!), enabled: !!open });
  if (!files.data) return files.error ? <View style={{ padding: 16 }}><ErrorText error={files.error} /></View> : <Loading />;
  if (open) {
    return (
      <View style={{ flex: 1, padding: 16, gap: 10 }}>
        <Pressable onPress={() => setOpen(null)} accessibilityRole="button"><Text style={{ color: c.brand, fontWeight: '600' }}>‹ All files</Text></Pressable>
        <Text style={{ color: c.textMuted, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13 }}>{open}</Text>
        <ScrollView style={{ flex: 1, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border }} horizontal={false}>
          <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
            <Text selectable style={{ color: c.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, lineHeight: 19 }}>{file.data?.content ?? '…'}</Text>
          </ScrollView>
        </ScrollView>
      </View>
    );
  }
  return (
    <FlatList
      data={files.data}
      keyExtractor={(f) => f.path}
      contentContainerStyle={{ padding: 16, gap: 6 }}
      ListEmptyComponent={<Card><Body muted>Files appear once the first generation finishes.</Body></Card>}
      renderItem={({ item }) => (
        <Pressable onPress={() => setOpen(item.path)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ color: c.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 14 }}>{item.path}</Text>
        </Pressable>
      )}
    />
  );
}

function Versions({ projectId, busy }: { projectId: string; busy: boolean }) {
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['versions', projectId], queryFn: () => api.versions(projectId) });
  const restore = useMutation({
    mutationFn: (vid: string) => api.restore(projectId, vid),
    onSuccess: () => {
      for (const k of ['versions', 'files']) void qc.invalidateQueries({ queryKey: [k, projectId] });
    },
  });
  if (!q.data) return <Loading />;
  return (
    <FlatList
      data={q.data}
      keyExtractor={(v) => v.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListHeaderComponent={<ErrorText error={restore.error} />}
      ListEmptyComponent={<Card><Body muted>Every successful generation or edit is saved as a version you can restore.</Body></Card>}
      renderItem={({ item: v }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ color: c.text, fontWeight: '700', width: 32 }}>v{v.number}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 15 }} numberOfLines={2}>{v.message}</Text>
            <Text style={{ color: c.textSubtle, fontSize: 12 }}>{new Date(v.createdAt).toLocaleString()}</Text>
          </View>
          {v.isHead ? <Text style={{ color: c.success, fontWeight: '600', fontSize: 13 }}>Current</Text> : <Button title="Restore" variant="secondary" onPress={() => restore.mutate(v.id)} disabled={busy} loading={restore.isPending && restore.variables === v.id} />}
        </Card>
      )}
    />
  );
}
