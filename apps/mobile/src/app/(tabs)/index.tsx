import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { PhaseBadge, ProjectRow, TYPE_META, TYPE_ORDER, TypeTile } from '@/components/bits';
import { Body, Caption, Card, EmptyState, ErrorState, H3, Icon, Page, Row, Section, SkeletonCards, Skeleton, StatusBadge } from '@/components/ui';
import { api, billing, challenges } from '@/lib/api';
import { ago, until } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function Home() {
  const { c, radius } = useTheme();
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const plan = useQuery({ queryKey: ['billing'], queryFn: billing.overview });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api.activity(5) });
  const ach = useQuery({ queryKey: ['achievements'], queryFn: api.achievements });
  const ch = useQuery({ queryKey: ['challenges'], queryFn: challenges.list });
  const refreshing = projects.isRefetching || plan.isRefetching || activity.isRefetching;
  const name = me.data?.displayName || me.data?.email.split('@')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const live = ch.data?.enabled ? [...ch.data.current][0] : undefined;
  const active = (projects.data?.items ?? []).filter((p) => p.status !== 'archived');

  return (
    <Page topInset title={name ? `${greeting}, ${name}` : greeting} subtitle="What are we building today?" testID="home"
      onRefresh={() => { void projects.refetch(); void plan.refetch(); void activity.refetch(); void ach.refetch(); void ch.refetch(); }} refreshing={refreshing}>
      <Pressable onPress={() => router.push('/create')} accessibilityRole="button" accessibilityLabel="Describe a new idea"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.xl, backgroundColor: pressed ? c.primaryHover : c.primary })}>
        <Icon name="edit-3" color={c.primaryFg} />
        <Text style={{ color: c.primaryFg, fontSize: 16, flex: 1, opacity: 0.85 }}>Describe your idea…</Text>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-up" size={18} color={c.accentFg} /></View>
      </Pressable>

      <Row gap={10}>
        <Card style={{ flex: 1 }} onPress={() => router.push('/plan')} accessibilityLabel="Credits and plan">
          <Caption>Credits</Caption>
          {plan.data ? <Text style={{ color: c.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.6 }}>{plan.data.credits.total.toLocaleString()}</Text> : <Skeleton height={30} width={80} />}
          <Caption numberOfLines={1}>{plan.data ? `${plan.data.plan.name} plan` : ' '}</Caption>
        </Card>
        <Card style={{ flex: 1 }} onPress={() => router.push('/achievements')} accessibilityLabel="Build streak and badges">
          <Caption>Build streak</Caption>
          {ach.data ? <Text style={{ color: c.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.6 }}>{ach.data.streak.current} <Text style={{ fontSize: 15, color: c.textMuted, fontWeight: '500' }}>{ach.data.streak.current === 1 ? 'day' : 'days'}</Text></Text> : <Skeleton height={30} width={80} />}
          <Caption numberOfLines={1}>{ach.data ? `${ach.data.badges.filter((b) => b.earnedAt).length} of ${ach.data.badges.length} badges` : ' '}</Caption>
        </Card>
      </Row>

      {live ? (
        <Card tone="accent" onPress={() => router.push({ pathname: '/challenges/[slug]', params: { slug: live.slug } })} accessibilityLabel={`Challenge: ${live.title}`}>
          <Row style={{ justifyContent: 'space-between' }}><PhaseBadge phase={live.phase} /><Caption>{until(live.phase === 'voting' ? live.votingClosesAt : live.submissionsCloseAt)}</Caption></Row>
          <H3>{live.title}</H3>
          <Body muted numberOfLines={2}>{live.brief}</Body>
        </Card>
      ) : null}

      <Section title="Continue building" action={active.length > 3 ? 'All projects' : undefined} onAction={() => router.push('/projects')}>
        {projects.error ? <ErrorState error={projects.error} onRetry={() => void projects.refetch()} /> : !projects.data ? <SkeletonCards count={2} height={66} /> : active.length === 0 ? (
          <Card><EmptyState icon="feather" title="Your first project starts with a sentence" body="Tell us what you want to make. You'll see a plan before anything is built." action="Start a project" onAction={() => router.push('/create')} /></Card>
        ) : active.slice(0, 3).map((p) => <ProjectRow key={p.id} project={p} />)}
      </Section>

      {activity.data && activity.data.length > 0 ? (
        <Section title="Recent activity">
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {activity.data.map((r, i) => (
              <Pressable key={r.id} onPress={() => router.push({ pathname: '/project/[id]', params: { id: r.project.id } })} accessibilityRole="button"
                style={{ paddingVertical: 10, gap: 4, borderTopWidth: i ? 1 : 0, borderColor: c.border }}>
                <Row style={{ justifyContent: 'space-between' }}><Caption numberOfLines={1} style={{ flex: 1 }}>{r.project.name} · {ago(r.createdAt)}</Caption><StatusBadge status={r.status} /></Row>
                <Body numberOfLines={2}>{r.kind === 'plan' ? 'Plan: ' : r.kind === 'ask' ? 'Question: ' : ''}{r.prompt}</Body>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Start from a type">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {TYPE_ORDER.slice(0, 6).map((t) => (
            <Pressable key={t} onPress={() => router.push({ pathname: '/create', params: { type: t } })} accessibilityRole="button" accessibilityLabel={`New ${TYPE_META[t].label}`}
              style={({ pressed }) => ({ width: '31%', flexGrow: 1, minWidth: 96, padding: 12, gap: 8, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surfaceMuted : c.surface })}>
              <TypeTile type={t} size={34} />
              <Text numberOfLines={1} style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>{TYPE_META[t].label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
    </Page>
  );
}
