import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { TYPE_META } from '@/components/bits';
import { Avatar, Badge, Body, Button, Caption, Card, ErrorState, ErrorText, Field, Group, H1, H3, Icon, IconButton, ListRow, Muted, Page, Row, Sheet, SkeletonCards, Stat, confirmAction, toast } from '@/components/ui';
import { CATEGORY_LABELS, REPORT_REASONS, showcase, WEB_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, initials } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';

export default function ShowcaseScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { c } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const hideCreator = usePrefs((s) => s.hideCreator);
  const [more, setMore] = useState(false);
  const [report, setReport] = useState(false);
  const q = useQuery({ queryKey: ['showcase', slug], queryFn: () => showcase.page(slug) });
  useEffect(() => { void showcase.view(slug).catch(() => undefined); }, [slug]);
  const like = useMutation({
    mutationFn: (on: boolean) => showcase.like(slug, on),
    onSuccess: (r) => qc.setQueryData(['showcase', slug], (old: typeof q.data) => (old ? { ...old, likedByMe: r.liked, likes: r.likes } : old)),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not like this.'),
  });
  const remix = useMutation({
    mutationFn: () => showcase.remix(slug),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Remix created in your projects'); router.push({ pathname: '/project/[id]', params: { id: p.id } }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remix this.'),
  });
  const d = q.data;
  const url = WEB_URL ? `${WEB_URL}/p/${slug}` : null;

  return (
    <>
      <Stack.Screen options={{ title: '', headerRight: () => (d ? <IconButton icon="more-horizontal" label="More" onPress={() => setMore(true)} /> : null) }} />
      <Page onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d ? <SkeletonCards count={3} height={110} /> : (
          <>
            <View style={{ gap: 8 }}>
              <Row gap={8} wrap>
                <Badge label={TYPE_META[d.type]?.label ?? d.type} icon={TYPE_META[d.type]?.icon} />
                {d.category ? <Badge label={CATEGORY_LABELS[d.category]} /> : null}
                {d.featured ? <Badge label="Featured" tone="accent" icon="star" /> : null}
              </Row>
              <H1>{d.title}</H1>
              {d.description ? <Muted>{d.description}</Muted> : null}
              <Row gap={10} style={{ marginTop: 4 }}>
                <Avatar label={initials(d.creator.name ?? '?')} size={32} />
                <View style={{ flex: 1 }}><Body style={{ fontWeight: '600' }}>{d.creator.name ?? 'A creator'}</Body>{d.publishedAt ? <Caption>Published {ago(d.publishedAt)}</Caption> : null}</View>
              </Row>
            </View>

            <Row gap={8}>
              <Button title={`${d.likes}`} icon="heart" variant={d.likedByMe ? 'accent' : 'secondary'} accessibilityLabel={d.likedByMe ? 'Unlike' : 'Like'}
                onPress={() => (session ? like.mutate(!d.likedByMe) : router.push('/login'))} loading={like.isPending} style={{ flex: 1 }} />
              {d.allowRemix && !d.isOwner ? <Button title="Remix" icon="git-branch" variant="secondary" style={{ flex: 1 }} loading={remix.isPending}
                onPress={async () => { if (!session) return router.push('/login'); if (await confirmAction({ title: 'Remix this project?', body: 'You get your own copy of the published version in your projects, to change however you like.', confirm: 'Remix' })) remix.mutate(); }} /> : null}
              {url ? <IconButton icon="share-2" label="Share" onPress={() => void Share.share({ message: `${d.title} — ${url}`, url })} /> : null}
            </Row>
            {d.playable && url ? <Button title={d.type === 'ecommerce' ? 'Open the shop' : 'Play in your browser'} icon="external-link" onPress={() => void Linking.openURL(url)} full /> : null}

            <Card style={{ flexDirection: 'row', gap: 12 }}>
              <Stat label="Views" value={d.views.toLocaleString()} />
              <Stat label="Remixes" value={d.remixes.toLocaleString()} />
              <Stat label="Files" value={d.fileCount.toLocaleString()} />
            </Card>

            {d.summary ? <View style={{ gap: 6 }}><H3>About</H3><Body>{d.summary}</Body>{d.audience ? <Caption>For: {d.audience}</Caption> : null}</View> : null}
            {d.pages.length ? (
              <View style={{ gap: 8 }}>
                <H3>{d.pages.length === 1 ? 'Page' : `${d.pages.length} pages`}</H3>
                <Group>{d.pages.map((p) => <ListRow key={p.route} icon="file" title={p.title} subtitle={p.purpose} />)}</Group>
              </View>
            ) : null}
            {d.isOwner && d.projectId ? <Button title="Open in your projects" variant="secondary" icon="folder" onPress={() => router.push({ pathname: '/project/[id]', params: { id: d.projectId! } })} full /> : null}
          </>
        )}
      </Page>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <Group>
          <ListRow icon="flag" title="Report this project" onPress={() => { setMore(false); if (!session) router.push('/login'); else setReport(true); }} chevron={false} />
          {d?.creator.handle && !d.isOwner ? (
            <ListRow icon="eye-off" title={`Hide projects by ${d.creator.name ?? 'this creator'}`} subtitle="On this device. Undo in Account → Hidden creators."
              onPress={() => { hideCreator(d.creator.handle!); setMore(false); toast.success('You won’t see their projects'); router.back(); }} chevron={false} />
          ) : null}
        </Group>
      </Sheet>
      <ReportSheet open={report} onClose={() => setReport(false)} slug={slug} />
    </>
  );
}

function ReportSheet({ open, onClose, slug }: { open: boolean; onClose: () => void; slug: string }) {
  const { c } = useTheme();
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const send = useMutation({
    mutationFn: () => showcase.report(slug, reason, details.trim()),
    onSuccess: (r) => { toast.success(r.duplicate ? 'You already reported this. Thanks.' : 'Thanks. Our team will review it.'); setReason(''); setDetails(''); onClose(); },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Report project">
      <Muted>Tell us what's wrong. Reports are reviewed by a person; projects with several reports are hidden until then.</Muted>
      <Group>
        {REPORT_REASONS.map((r) => (
          <ListRow key={r.value} title={r.label} onPress={() => setReason(r.value)} chevron={false}
            right={reason === r.value ? <Icon name="check" color={c.accent} /> : null} />
        ))}
      </Group>
      <Field label="Details (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} style={{ minHeight: 80 }} />
      <ErrorText error={send.error} />
      <Button title="Send report" onPress={() => send.mutate()} disabled={!reason} loading={send.isPending} full />
    </Sheet>
  );
}
