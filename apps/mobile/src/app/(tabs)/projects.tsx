import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProjectRow } from '@/components/bits';
import { Card, EmptyState, ErrorState, H1, IconButton, Icon, Row, Screen, Segmented, SkeletonCards } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export default function Projects() {
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const q = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.items ?? []).filter((p) => (filter === 'archived') === (p.status === 'archived') && (!s || p.name.toLowerCase().includes(s)));
  }, [q.data, filter, search]);

  return (
    <Screen>
      <FlatList
        testID="projects"
        data={q.data ? items : []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, gap: 10, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <H1>Projects</H1>
              <IconButton icon="plus" label="New project" onPress={() => router.push('/create')} />
            </Row>
            <Row gap={8} style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: c.surfaceMuted }}>
              <Icon name="search" size={16} color={c.textSubtle} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search projects" placeholderTextColor={c.textSubtle} accessibilityLabel="Search projects"
                style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 10 }} autoCorrect={false} clearButtonMode="while-editing" />
            </Row>
            <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
            {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <SkeletonCards count={4} height={66} /> : null}
          </View>
        }
        renderItem={({ item }) => <ProjectRow project={item} />}
        ListEmptyComponent={q.data ? (
          <Card>
            {search ? <EmptyState icon="search" title="No matches" body={`Nothing called “${search.trim()}”.`} />
              : filter === 'archived' ? <EmptyState icon="archive" title="Nothing archived" body="Archived projects wait here. You can bring them back any time." />
              : <EmptyState icon="folder-plus" title="No projects yet" body="Describe an idea and get a working project you own." action="Create a project" onAction={() => router.push('/create')} />}
          </Card>
        ) : undefined}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.accent} />}
      />
    </Screen>
  );
}
