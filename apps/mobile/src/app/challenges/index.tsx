import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { PhaseBadge, TYPE_META, entriesText } from '@/components/bits';
import { Body, Caption, Card, EmptyState, ErrorState, H3, Muted, Page, Row, Section, SkeletonCards } from '@/components/ui';
import { challenges, type ChallengeSummary } from '@/lib/api';
import { dateTime, until } from '@/lib/format';

export default function Challenges() {
  const q = useQuery({ queryKey: ['challenges'], queryFn: challenges.list });
  const d = q.data;
  return (
    <Page subtitle="Build to a brief, then vote for your favourites. Winners are decided by the community." onRefresh={() => void q.refetch()} refreshing={q.isRefetching} testID="challenges">
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <SkeletonCards count={3} height={110} /> : !d.enabled ? (
        <Card><EmptyState icon="pause-circle" title="Challenges are paused" body="Check back soon." /></Card>
      ) : (
        <>
          <Section title="Running now">{d.current.length ? d.current.map((c) => <ChallengeCard key={c.slug} c={c} />) : <Card><Muted>No challenge is running right now.</Muted></Card>}</Section>
          {d.upcoming.length ? <Section title="Coming up">{d.upcoming.map((c) => <ChallengeCard key={c.slug} c={c} />)}</Section> : null}
          {d.past.length ? <Section title="Past">{d.past.map((c) => <ChallengeCard key={c.slug} c={c} />)}</Section> : null}
        </>
      )}
    </Page>
  );
}

function ChallengeCard({ c }: { c: ChallengeSummary }) {
  const router = useRouter();
  const deadline = c.phase === 'open' ? `Entries close · ${until(c.submissionsCloseAt)}` : c.phase === 'voting' ? `Voting closes · ${until(c.votingClosesAt)}` : c.phase === 'upcoming' ? `Starts ${dateTime(c.startsAt)}` : `Ended ${dateTime(c.votingClosesAt)}`;
  return (
    <Card onPress={() => router.push({ pathname: '/challenges/[slug]', params: { slug: c.slug } })} accessibilityLabel={c.title}>
      <Row style={{ justifyContent: 'space-between' }}><PhaseBadge phase={c.phase} /><Caption>{entriesText(c.entries)}</Caption></Row>
      <H3>{c.title}</H3>
      <Body muted numberOfLines={2}>{c.brief}</Body>
      <Caption>{deadline} · {c.projectTypes.map((t) => TYPE_META[t]?.label ?? t).join(', ')}</Caption>
    </Card>
  );
}
