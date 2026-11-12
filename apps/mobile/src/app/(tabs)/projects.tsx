import { useQuery } from '@tanstack/react-query';
import { FlatList, RefreshControl, View } from 'react-native';
import { ProjectRow } from '@/components/project-row';
import { Body, Card, ErrorText, Loading, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export default function Projects() {
  const { c } = useTheme();
  const q = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  if (!q.data) return <Screen>{q.error ? <View style={{ padding: 20 }}><ErrorText error={q.error} /></View> : <Loading />}</Screen>;
  return (
    <Screen>
      <FlatList
        data={q.data.items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 20, gap: 10 }}
        renderItem={({ item }) => <ProjectRow project={item} />}
        ListEmptyComponent={<Card><Body muted>Your projects will appear here.</Body></Card>}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.brand} />}
      />
    </Screen>
  );
}
