import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Avatar, Badge, Body, Button, Caption, Card, ErrorState, Group, H2, Icon, ListRow, Muted, Page, Row, Section, Segmented, Sheet, Skeleton, confirmAction } from '@/components/ui';
import { api, isOwner, WEB_URL } from '@/lib/api';
import { initials } from '@/lib/format';
import { usePrefs, type ThemePref } from '@/lib/prefs';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function Account() {
  const { c } = useTheme();
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { theme, setTheme, workspaceId, setWorkspace, hiddenCreators, unhideCreator } = usePrefs();
  const [switcher, setSwitcher] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const d = me.data;
  const current = d?.organizations.find((o) => o.id === (workspaceId ?? d.personalOrgId)) ?? d?.organizations.find((o) => o.personal);
  const legal = (slug: string) => void Linking.openURL(`${WEB_URL}/legal/${slug}`);

  return (
    <Page topInset title="Account" onRefresh={() => void me.refetch()} refreshing={me.isRefetching} testID="account">
      {me.error ? <ErrorState error={me.error} onRetry={() => void me.refetch()} /> : (
        <Card onPress={() => router.push('/profile')} accessibilityLabel="Edit profile">
          <Row gap={14}>
            {d ? <Avatar label={initials(d.displayName || d.email)} size={52} /> : <Skeleton width={52} height={52} radius={26} />}
            <View style={{ flex: 1, gap: 2 }}>
              {d ? <H2 style={{ fontSize: 18 }}>{d.displayName || d.email.split('@')[0]}</H2> : <Skeleton width={140} height={20} />}
              <Caption numberOfLines={1}>{d?.email ?? ' '}</Caption>
              {d?.handle ? <Caption>@{d.handle}</Caption> : null}
            </View>
            <Icon name="chevron-right" color={c.textSubtle} />
          </Row>
        </Card>
      )}

      {d && d.organizations.length > 1 ? (
        <Section title="Workspace">
          <Group><ListRow icon="users" title={current?.personal ? 'Personal workspace' : current?.name ?? 'Workspace'} subtitle={`${current?.role ?? ''} · tap to switch`} onPress={() => setSwitcher(true)} /></Group>
        </Section>
      ) : null}

      <Section title="Your building">
        <Group>
          <ListRow icon="pie-chart" title="Plan and usage" onPress={() => router.push('/plan')} />
          <ListRow icon="award" title="Badges and streak" onPress={() => router.push('/achievements')} />
          <ListRow icon="flag" title="Challenges" onPress={() => router.push('/challenges')} />
        </Group>
      </Section>

      <Section title="Appearance">
        <Segmented<ThemePref> label="Appearance" value={theme} onChange={setTheme} options={[{ value: 'system', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Section>

      {isOwner(d) ? (
        <Section title="Owner">
          <Group>
            <ListRow icon="activity" title="Business overview" subtitle="Users, revenue, AI cost and margin" onPress={() => router.push('/owner')} />
            <ListRow icon="toggle-right" title="Kill switches" subtitle="Turn platform features on or off" onPress={() => router.push('/owner/flags')} />
          </Group>
        </Section>
      ) : null}

      <Section title="Privacy and safety">
        <Group>
          <ListRow icon="eye-off" title="Hidden creators" subtitle={hiddenCreators.length ? `${hiddenCreators.length} hidden on this device` : 'None'} onPress={() => setHiddenOpen(true)} />
          {WEB_URL ? <ListRow icon="shield" title="Privacy Policy" onPress={() => legal('privacy')} /> : null}
          {WEB_URL ? <ListRow icon="file-text" title="Terms of Service" onPress={() => legal('terms')} /> : null}
          {WEB_URL ? <ListRow icon="alert-octagon" title="Acceptable Use" onPress={() => legal('acceptable-use')} /> : null}
          {WEB_URL ? <ListRow icon="info" title="Credits and open-source notices" onPress={() => void Linking.openURL(`${WEB_URL}/credits`)} /> : null}
        </Group>
      </Section>

      <Group>
        <ListRow icon="log-out" title="Sign out" chevron={false} onPress={async () => { if (await confirmAction({ title: 'Sign out?', confirm: 'Sign out' })) { setWorkspace(null); await supabase?.auth.signOut(); } }} />
        <ListRow icon="user-x" title="Delete account" destructive onPress={() => router.push('/delete-account')} />
      </Group>
      <Caption style={{ textAlign: 'center' }}>Make Your App AI {Constants.expoConfig?.version ?? ''}</Caption>

      <Sheet open={switcher} onClose={() => setSwitcher(false)} title="Switch workspace">
        <Muted>Projects, credits and plan belong to a workspace.</Muted>
        <Group>
          {(d?.organizations ?? []).map((o) => (
            <ListRow key={o.id} icon={o.personal ? 'user' : 'users'} title={o.personal ? 'Personal workspace' : o.name} subtitle={o.role} chevron={false}
              right={o.id === current?.id ? <Icon name="check" color={c.accent} /> : null}
              onPress={() => { setWorkspace(o.personal ? null : o.id); setSwitcher(false); }} />
          ))}
        </Group>
      </Sheet>

      <Sheet open={hiddenOpen} onClose={() => setHiddenOpen(false)} title="Hidden creators">
        {hiddenCreators.length === 0 ? <Body muted>You haven't hidden anyone. Use “Hide projects by…” on a project page to stop seeing someone's work.</Body> : (
          <Group>
            {hiddenCreators.map((h) => <ListRow key={h} icon="user" title={`@${h}`} chevron={false} right={<Button title="Show again" size="sm" variant="secondary" onPress={() => unhideCreator(h)} />} />)}
          </Group>
        )}
      </Sheet>
      {d && d.platformRole !== 'user' && !isOwner(d) ? <Badge label={`Role: ${d.platformRole}`} /> : null}
    </Page>
  );
}
