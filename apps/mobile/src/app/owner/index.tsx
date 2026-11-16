import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Body, Caption, Card, EmptyState, ErrorState, Group, ListRow, Page, Row, Section, Segmented, SkeletonCards, Stat } from '@/components/ui';
import { admin, api, isOwner } from '@/lib/api';
import { ago, money } from '@/lib/format';

export default function OwnerOverview() {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const allowed = isOwner(me.data);
  const o = useQuery({ queryKey: ['admin-overview', days], queryFn: () => admin.overview(Number(days)), enabled: allowed });
  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: admin.audit, enabled: allowed });
  if (me.data && !allowed) return <Page><Card><EmptyState icon="lock" title="Owners only" /></Card></Page>;
  const d = o.data;
  const mrr = d ? Object.entries(d.mrrMinor).filter(([, v]) => v > 0) : [];
  const failed = d?.generations.failed ?? 0;
  const ok = d?.generations.succeeded ?? 0;
  return (
    <Page onRefresh={() => { void o.refetch(); void audit.refetch(); }} refreshing={o.isRefetching} testID="owner">
      <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      {o.error ? <ErrorState error={o.error} onRetry={() => void o.refetch()} /> : !d ? <SkeletonCards count={4} height={90} /> : (
        <>
          <Card>
            <Row gap={12} wrap>
              <Stat label="MRR" value={mrr.length ? mrr.map(([cur, v]) => money(v, cur)).join(' + ') : '—'} tone="accent" />
              <Stat label="Paying" value={String(d.subscriptions.active)} hint={d.subscriptions.paymentProblems ? `${d.subscriptions.paymentProblems} payment problems` : undefined} />
            </Row>
          </Card>
          <Card>
            <Row gap={12} wrap>
              <Stat label="Users" value={d.users.total.toLocaleString()} hint={`+${d.users.new} new`} />
              <Stat label="Active" value={d.users.active.toLocaleString()} />
              <Stat label="Projects" value={d.projects.toLocaleString()} />
            </Row>
          </Card>
          <Card>
            <Row gap={12} wrap>
              <Stat label="AI cost" value={`$${d.ai.costUsd.toFixed(2)}`} />
              <Stat label="Builds" value={`${ok}`} hint={failed ? `${failed} failed` : undefined} />
              {d.grossMarginInr ? <Stat label="Margin" value={money(d.grossMarginInr.marginMinor, 'INR')} tone={d.grossMarginInr.marginMinor >= 0 ? 'success' : 'danger'} /> : null}
            </Row>
          </Card>
          {d.revenue.length ? (
            <Section title="Revenue">
              <Group>{d.revenue.map((r) => <ListRow key={r.currency} title={money(r.grossMinor, r.currency)} subtitle={`${r.invoices} invoices · refunds ${money(r.refundsMinor, r.currency)} · fees ${money(r.feesMinor, r.currency)}`} />)}</Group>
            </Section>
          ) : null}
          {d.notes.map((n) => <Caption key={n}>{n}</Caption>)}
        </>
      )}
      <Group><ListRow icon="toggle-right" title="Kill switches" onPress={() => router.push('/owner/flags')} /></Group>
      <Section title="Recent owner and system activity">
        {audit.error ? <ErrorState error={audit.error} /> : !audit.data ? <SkeletonCards count={3} height={50} /> : (
          <Group>{audit.data.slice(0, 20).map((a) => <ListRow key={a.id} title={a.action} subtitle={`${a.actor ?? 'system'} · ${ago(a.createdAt)}`} />)}</Group>
        )}
      </Section>
      <Body muted style={{ fontSize: 13 }}>Plans, prices, AI routes, moderation and challenges are managed in the web owner console.</Body>
    </Page>
  );
}
