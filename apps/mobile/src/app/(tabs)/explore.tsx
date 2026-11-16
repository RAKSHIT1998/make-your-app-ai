import type { ProjectType } from '@mya/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PhaseBadge, ShowcaseTile, TYPE_META, TYPE_ORDER } from '@/components/bits';
import { Body, Caption, Card, Chip, EmptyState, ErrorState, H1, H3, Icon, Loading, Row, Screen, Segmented, SkeletonCards } from '@/components/ui';
import { challenges, showcase, type ExploreQuery } from '@/lib/api';
import { until } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';

type Sort = NonNullable<ExploreQuery['sort']>;

export default function Explore() {
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hidden = usePrefs((s) => s.hiddenCreators);
  const [sort, setSort] = useState<Sort>('trending');
  const [type, setType] = useState<ProjectType | undefined>();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 350); return () => clearTimeout(t); }, [text]);
  const ch = useQuery({ queryKey: ['challenges'], queryFn: challenges.list });
  const feed = useInfiniteQuery({
    queryKey: ['explore', sort, type, q],
    queryFn: ({ pageParam }) => showcase.explore({ sort, type, q, page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
  const items = (feed.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !i.creator.handle || !hidden.includes(i.creator.handle));
  const live = ch.data?.enabled ? ch.data.current : [];

  return (
    <Screen>
      <FlatList
        testID="explore"
        data={items}
        keyExtractor={(i) => i.slug}
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, gap: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }}
        refreshControl={<RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => { void feed.refetch(); void ch.refetch(); }} tintColor={c.accent} />}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 4 }}>
            <H1>Explore</H1>
            {live.map((x) => (
              <Card key={x.slug} tone="accent" onPress={() => router.push({ pathname: '/challenges/[slug]', params: { slug: x.slug } })} accessibilityLabel={`Challenge: ${x.title}`}>
                <Row style={{ justifyContent: 'space-between' }}><PhaseBadge phase={x.phase} /><Caption>{until(x.phase === 'voting' ? x.votingClosesAt : x.submissionsCloseAt)}</Caption></Row>
                <H3>{x.title}</H3>
                <Body muted numberOfLines={2}>{x.brief}</Body>
              </Card>
            ))}
            <Row gap={10}>
              <Chip label="Challenges" icon="award" onPress={() => router.push('/challenges')} />
              <Chip label="Top creators" icon="bar-chart-2" onPress={() => router.push('/leaderboard')} />
            </Row>
            <Row gap={8} style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: c.surfaceMuted }}>
              <Icon name="search" size={16} color={c.textSubtle} />
              <TextInput value={text} onChangeText={setText} placeholder="Search what people built" placeholderTextColor={c.textSubtle} accessibilityLabel="Search Explore" autoCorrect={false}
                style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 10 }} returnKeyType="search" />
            </Row>
            <Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'trending', label: 'Trending' }, { value: 'recent', label: 'New' }, { value: 'popular', label: 'Liked' }, { value: 'featured', label: 'Featured' }]} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label="All" selected={!type} onPress={() => setType(undefined)} />
              {TYPE_ORDER.map((t) => <Chip key={t} label={TYPE_META[t].label} selected={type === t} onPress={() => setType(type === t ? undefined : t)} />)}
            </ScrollView>
            {feed.error ? <ErrorState error={feed.error} onRetry={() => void feed.refetch()} /> : feed.isPending ? <SkeletonCards count={3} height={150} /> : null}
          </View>
        }
        renderItem={({ item }) => <ShowcaseTile item={item} />}
        ListEmptyComponent={feed.data ? <Card><EmptyState icon="compass" title={q ? 'Nothing matches that yet' : 'Nothing here yet'} body={q ? 'Try fewer words or another type.' : 'Published projects will show up here.'} /></Card> : undefined}
        ListFooterComponent={feed.isFetchingNextPage ? <Loading /> : undefined}
      />
    </Screen>
  );
}
