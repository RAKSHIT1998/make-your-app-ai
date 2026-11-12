import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { ProjectRow } from '@/components/project-row';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

export default function Home() {
  const { c } = useTheme();
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const credits = useQuery({ queryKey: ['credits'], queryFn: api.credits });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const refreshing = projects.isRefetching || credits.isRefetching;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void projects.refetch(); void credits.refetch(); }} tintColor={c.brand} />}>
        <View style={{ gap: 4 }}>
          <Title>{me.data ? `Hi, ${me.data.email.split('@')[0]}` : 'Welcome'}</Title>
          <Body muted>What would you like to build today?</Body>
        </View>
        <Card style={{ gap: 4 }}>
          <Body muted>Credits available</Body>
          <Text style={{ color: c.text, fontSize: 32, fontWeight: '700' }}>{credits.data?.balance ?? '—'}</Text>
        </Card>
        <Button title="New project" onPress={() => router.push('/create')} />
        <View style={{ gap: 10 }}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>Recent projects</Text>
          <ErrorText error={projects.error} />
          {!projects.data ? <Loading /> : projects.data.items.length === 0 ? (
            <Card><Body muted>No projects yet. Describe an idea and get a working website you own.</Body></Card>
          ) : projects.data.items.slice(0, 5).map((p) => <ProjectRow key={p.id} project={p} />)}
        </View>
      </ScrollView>
    </Screen>
  );
}
