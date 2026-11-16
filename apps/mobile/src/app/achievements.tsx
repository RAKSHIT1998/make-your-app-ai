import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { Body, Caption, Card, ErrorState, H3, Icon, Page, Row, Section, SkeletonCards, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function Achievements() {
  const { c } = useTheme();
  const q = useQuery({ queryKey: ['achievements'], queryFn: api.achievements });
  const d = q.data;
  return (
    <Page subtitle="Earned from what you actually build, publish and share." onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <SkeletonCards count={4} /> : (
        <>
          <Card>
            <Row gap={12}>
              <Stat label="Current streak" value={`${d.streak.current} ${d.streak.current === 1 ? 'day' : 'days'}`} tone="accent" />
              <Stat label="Longest" value={`${d.streak.longest} ${d.streak.longest === 1 ? 'day' : 'days'}`} />
            </Row>
            <Caption>Last 30 days — a day counts when a build or change succeeds.</Caption>
            <View accessibilityLabel={`${d.streak.last30.filter(Boolean).length} active days in the last 30`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {d.streak.last30.map((on, i) => <View key={i} style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: on ? c.accent : c.surfaceSunken }} />)}
            </View>
          </Card>
          <Section title={`Badges · ${d.badges.filter((b) => b.earnedAt).length} of ${d.badges.length}`}>
            {d.badges.map((b) => (
              <Card key={b.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: b.earnedAt ? 1 : 0.6 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: b.earnedAt ? c.accentSoft : c.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={b.earnedAt ? 'award' : 'lock'} color={b.earnedAt ? c.accentText : c.textSubtle} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <H3>{b.title}</H3>
                  <Body muted>{b.description}</Body>
                </View>
                {b.earnedAt ? <Text style={{ color: c.textSubtle, fontSize: 12 }}>{ago(b.earnedAt)}</Text> : null}
              </Card>
            ))}
          </Section>
        </>
      )}
    </Page>
  );
}
