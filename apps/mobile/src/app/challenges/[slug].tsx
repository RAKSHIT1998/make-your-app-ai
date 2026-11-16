import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PhaseBadge, ShowcaseTile, TYPE_META, entriesText } from '@/components/bits';
import { Badge, Body, Button, Caption, Card, EmptyState, ErrorState, ErrorText, Field, Group, H1, H3, Icon, ListRow, Muted, Page, Row, Section, Sheet, SkeletonCards, confirmAction, toast } from '@/components/ui';
import { challenges, type ChallengeDetail, type ChallengeEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, plural, until } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';

export default function ChallengeScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const hidden = usePrefs((s) => s.hiddenCreators);
  const [enterOpen, setEnterOpen] = useState(false);
  const q = useQuery({ queryKey: ['challenge', slug], queryFn: () => challenges.get(slug) });
  const set = (d: ChallengeDetail) => { qc.setQueryData(['challenge', slug], d); void qc.invalidateQueries({ queryKey: ['challenges'] }); };
  const vote = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => challenges.vote(slug, id, on),
    onSuccess: set,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not vote.'),
  });
  const withdraw = useMutation({ mutationFn: (id: string) => challenges.withdraw(slug, id), onSuccess: (d) => { set(d); toast.success('Entry withdrawn'); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not withdraw.') });
  const d = q.data;
  const entries = (d?.entries ?? []).filter((e) => e.mine || !e.project.creator.handle || !hidden.includes(e.project.creator.handle));

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <Page onRefresh={() => void q.refetch()} refreshing={q.isRefetching} testID="challenge">
        {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <SkeletonCards count={3} height={110} /> : (
          <>
            <View style={{ gap: 8 }}>
              <PhaseBadge phase={d.phase} />
              <H1>{d.title}</H1>
              <Body>{d.brief}</Body>
            </View>
            <Card style={{ gap: 6 }}>
              <Info icon="layers" text={`For: ${d.projectTypes.map((t) => TYPE_META[t]?.label ?? t).join(', ')}`} />
              <Info icon="log-in" text={`Entries close ${dateTime(d.submissionsCloseAt)}${d.phase === 'open' ? ` (${until(d.submissionsCloseAt)})` : ''}`} />
              <Info icon="check-square" text={`Voting closes ${dateTime(d.votingClosesAt)}${d.phase === 'voting' ? ` (${until(d.votingClosesAt)})` : ''}`} />
              <Info icon="thumbs-up" text={`${plural(d.votesPerUser, 'vote')} per person`} />
              {d.prize ? <Info icon="gift" text={`Prize: ${d.prize}`} /> : null}
            </Card>

            {d.phase === 'open' ? (
              session ? (
                d.myEntry ? <Card tone="success"><Row><Icon name="check-circle" /><H3 style={{ flex: 1 }}>Your workspace has entered</H3></Row><Muted>You can withdraw while entries are open.</Muted></Card>
                  : <Button title="Enter a project" icon="plus" onPress={() => setEnterOpen(true)} full />
              ) : <Button title="Sign in to enter" onPress={() => router.push('/login')} full />
            ) : null}
            {(d.phase === 'open' || d.phase === 'voting') && session && d.myVotesLeft !== null ? (
              <Caption>{d.myVotesLeft > 0 ? `You have ${plural(d.myVotesLeft, 'vote')} left.` : 'You have used all your votes. Remove one to vote again.'}</Caption>
            ) : null}

            <Section title={d.phase === 'ended' ? 'Results' : 'Leaderboard'}>
              {entries.length === 0 ? <Card><EmptyState icon="award" title="No entries yet" body={d.phase === 'open' ? 'Be the first to enter.' : undefined} /></Card> : entries.map((e) => (
                <EntryRow key={e.id} e={e} phase={d.phase} canVote={!!session && (d.phase === 'open' || d.phase === 'voting')} votesLeft={d.myVotesLeft ?? 0}
                  busy={vote.isPending && vote.variables?.id === e.id}
                  onVote={(on) => (session ? vote.mutate({ id: e.id, on }) : router.push('/login'))}
                  onWithdraw={async () => { if (await confirmAction({ title: 'Withdraw your entry?', body: 'Its votes are lost. You can enter again while entries are open.', confirm: 'Withdraw', destructive: true })) withdraw.mutate(e.id); }} />
              ))}
              {d.entries.length ? <Caption>{entriesText(d.entries.length)}</Caption> : null}
            </Section>
          </>
        )}
      </Page>
      {d ? <EnterSheet open={enterOpen} onClose={() => setEnterOpen(false)} slug={slug} onDone={set} /> : null}
    </>
  );
}

function Info({ icon, text }: { icon: React.ComponentProps<typeof Icon>['name']; text: string }) {
  const { c } = useTheme();
  return <Row gap={10} style={{ alignItems: 'flex-start' }}><Icon name={icon} size={15} color={c.textMuted} style={{ marginTop: 3 }} /><Body style={{ flex: 1 }}>{text}</Body></Row>;
}

function EntryRow({ e, phase, canVote, votesLeft, busy, onVote, onWithdraw }: { e: ChallengeEntry; phase: ChallengeDetail['phase']; canVote: boolean; votesLeft: number; busy: boolean; onVote: (on: boolean) => void; onWithdraw: () => void }) {
  const { c, radius } = useTheme();
  const medal = e.winner ? ['🥇', '🥈', '🥉'][e.rank - 1] : null;
  return (
    <ShowcaseTile item={e.project} footer={
      <Row gap={10}>
        <View style={{ minWidth: 42, alignItems: 'center' }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }} accessibilityLabel={`Rank ${e.rank}`}>{medal ?? `#${e.rank}`}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Body style={{ fontWeight: '600' }}>{plural(e.votes, 'vote')}</Body>
          {e.note ? <Caption numberOfLines={2}>{e.note}</Caption> : null}
        </View>
        {e.mine ? (
          phase === 'open' ? <Button title="Withdraw" size="sm" variant="ghost" onPress={onWithdraw} /> : <Badge label="Yours" tone="accent" />
        ) : canVote ? (
          <Pressable onPress={() => onVote(!e.votedByMe)} disabled={busy || (!e.votedByMe && votesLeft <= 0)} accessibilityRole="button"
            accessibilityLabel={e.votedByMe ? `Voted for ${e.project.title} (remove vote)` : `Vote for ${e.project.title}`} accessibilityState={{ selected: e.votedByMe, busy }}
            style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
              backgroundColor: e.votedByMe ? c.accent : c.surface, borderColor: e.votedByMe ? c.accent : c.borderStrong, opacity: !e.votedByMe && votesLeft <= 0 ? 0.4 : 1 }}>
            <Icon name="thumbs-up" size={15} color={e.votedByMe ? c.accentFg : c.text} />
            <Text style={{ color: e.votedByMe ? c.accentFg : c.text, fontWeight: '600' }}>{e.votedByMe ? 'Voted' : 'Vote'}</Text>
          </Pressable>
        ) : null}
      </Row>
    } />
  );
}

function EnterSheet({ open, onClose, slug, onDone }: { open: boolean; onClose: () => void; slug: string; onDone: (d: ChallengeDetail) => void }) {
  const router = useRouter();
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['challenge-eligible', slug], queryFn: () => challenges.eligible(slug), enabled: open });
  const enter = useMutation({ mutationFn: () => challenges.enter(slug, pick!, note.trim()), onSuccess: (d) => { onDone(d); toast.success('You’re in. Good luck!'); onClose(); } });
  const { c } = useTheme();
  return (
    <Sheet open={open} onClose={onClose} title="Enter a project">
      <Muted>Pick one of your published projects of an allowed type. One entry per workspace.</Muted>
      {q.error ? <ErrorText error={q.error} /> : !q.data ? <SkeletonCards count={2} height={56} /> : q.data.length === 0 ? (
        <Card><EmptyState icon="send" title="No eligible projects" body="Publish a project of an allowed type first, from its Share tab." action="Start one" onAction={() => { onClose(); router.push('/create'); }} /></Card>
      ) : (
        <Group>
          {q.data.map((p) => (
            <ListRow key={p.id} icon={TYPE_META[p.type]?.icon} title={p.title} subtitle={TYPE_META[p.type]?.label} onPress={() => setPick(p.id)} chevron={false}
              right={pick === p.id ? <Icon name="check-circle" color={c.accent} /> : null} />
          ))}
        </Group>
      )}
      <Field label="A note for voters (optional)" value={note} onChangeText={setNote} maxLength={300} multiline style={{ minHeight: 70 }} />
      <ErrorText error={enter.error} />
      <Button title="Enter" onPress={() => enter.mutate()} disabled={!pick} loading={enter.isPending} full />
    </Sheet>
  );
}
