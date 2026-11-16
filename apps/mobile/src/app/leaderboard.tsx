import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { Avatar, Caption, Card, EmptyState, ErrorState, Page, Row, SkeletonCards } from '@/components/ui';
import { challenges } from '@/lib/api';
import { initials } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';

export default function Leaderboard() {
  const { c } = useTheme();
  const hidden = usePrefs((s) => s.hiddenCreators);
  const q = useQuery({ queryKey: ['leaderboard'], queryFn: challenges.creators });
  const rows = (q.data ?? []).filter((r) => !hidden.includes(r.handle));
  return (
    <Page subtitle="The last 30 days. Likes from others count 1 point, remixes 3, challenge podium finishes 10." onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <SkeletonCards count={5} height={64} /> : rows.length === 0 ? (
        <Card><EmptyState icon="bar-chart-2" title="No ranking yet" body="Publish something people like, remix or vote for." /></Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {rows.map((r, i) => (
            <Row key={r.handle} gap={12} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: c.border }}>
              <Text style={{ width: 30, color: r.rank <= 3 ? c.accentText : c.textMuted, fontWeight: '700', fontSize: 16 }}>{r.rank}</Text>
              <Avatar label={initials(r.name)} size={36} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: c.text, fontWeight: '600', fontSize: 15 }}>{r.name}</Text>
                <Caption>{r.likes} likes · {r.remixes} remixes{r.podiums ? ` · ${r.podiums} podium` : ''}</Caption>
              </View>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>{r.score}</Text>
            </Row>
          ))}
        </Card>
      )}
    </Page>
  );
}
