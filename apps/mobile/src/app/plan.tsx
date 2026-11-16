import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Badge, Body, Caption, Card, EmptyState, ErrorState, Group, H2, ListRow, Muted, Page, Row, Section, SkeletonCards, Stat } from '@/components/ui';
import { billing } from '@/lib/api';
import { ago, dateTime, money } from '@/lib/format';
import { useTheme } from '@/lib/theme';

const REASON: Record<string, string> = {
  ai_usage: 'AI building', infra_usage: 'Hosting and services', plan_grant: 'Monthly credits', purchase: 'Credits added', refund: 'Refund',
  adjustment: 'Adjustment', expiry: 'Monthly credits expired', referral: 'Referral reward',
};

/** Read-only in the app: what the workspace has and has used. */
export default function PlanScreen() {
  const { c } = useTheme();
  const o = useQuery({ queryKey: ['billing'], queryFn: billing.overview });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => billing.usage(30) });
  const payg = useQuery({ queryKey: ['payg'], queryFn: billing.payg });
  const d = o.data;
  const p = payg.data;
  return (
    <Page onRefresh={() => { void o.refetch(); void usage.refetch(); void payg.refetch(); }} refreshing={o.isRefetching} testID="plan">
      {o.error ? <ErrorState error={o.error} onRetry={() => void o.refetch()} /> : !d ? <SkeletonCards count={3} height={110} /> : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <H2>{d.plan.name}</H2>
              {d.subscription ? <Badge label={d.subscription.cancelAtPeriodEnd ? 'Ends at period end' : d.subscription.status === 'past_due' ? 'Payment problem' : 'Active'} tone={d.subscription.cancelAtPeriodEnd || d.subscription.status === 'past_due' ? 'warning' : 'success'} /> : null}
            </Row>
            {d.subscription?.currentPeriodEnd ? <Caption>{d.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {dateTime(d.subscription.currentPeriodEnd)}</Caption> : d.period.end ? <Caption>Credits refresh {dateTime(d.period.end)}</Caption> : null}
            <Row gap={12} style={{ marginTop: 8 }}>
              <Stat label="Credits left" value={d.credits.total.toLocaleString()} tone="accent" />
              <Stat label="Used this period" value={d.credits.usedThisPeriod.toLocaleString()} />
            </Row>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceSunken, overflow: 'hidden', marginTop: 6 }} accessibilityLabel={`${d.credits.allowanceRemaining} of ${d.entitlements.monthlyCredits} monthly credits left`}>
              <View style={{ width: `${Math.min(100, d.entitlements.monthlyCredits ? (d.credits.allowanceRemaining / d.entitlements.monthlyCredits) * 100 : 0)}%`, height: 8, backgroundColor: c.accent }} />
            </View>
            <Caption>{d.credits.allowanceRemaining.toLocaleString()} of {d.entitlements.monthlyCredits.toLocaleString()} monthly credits left{d.credits.purchasedRemaining ? ` · ${d.credits.purchasedRemaining.toLocaleString()} extra credits (never expire)` : ''}</Caption>
          </Card>

          <Group>
            <ListRow icon="folder" title="Active projects" right={<Body>{d.usage.activeProjects} / {d.entitlements.maxActiveProjects}</Body>} />
            <ListRow icon="sun" title="Used today" right={<Body>{d.credits.usedToday}{d.entitlements.dailyCreditLimit !== null && !p?.active ? ` / ${d.entitlements.dailyCreditLimit}` : ''}</Body>} />
            <ListRow icon="zap" title="Most credits per build" right={<Body>{d.entitlements.maxCreditsPerRun}</Body>} />
            <ListRow icon="users" title="Team seats" right={<Body>{d.entitlements.teamSeats}</Body>} />
          </Group>

          {p && p.status !== 'none' ? (
            <Section title="Pay as you go">
              <Card tone={p.status === 'past_due' ? 'danger' : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Body style={{ fontWeight: '600' }}>{p.cardLabel ?? 'Saved card'}</Body>
                  <Badge label={p.status === 'active' ? 'On' : p.status === 'past_due' ? 'Payment failed' : p.status === 'pending' ? 'Checking card' : 'Off'} tone={p.status === 'active' ? 'success' : p.status === 'past_due' ? 'danger' : 'neutral'} />
                </Row>
                {p.currency ? <Caption>{p.usedThisMonth.toLocaleString()} of {p.capCredits.toLocaleString()} credits used this month · cap {money(p.monthlyCapMinor, p.currency)}</Caption> : null}
                {p.owedMinor > 0 && p.currency ? <Caption>Owed so far: {money(p.owedMinor, p.currency)}</Caption> : null}
                {p.premiumAi ? <Badge label="Premium AI on" tone="accent" icon="star" /> : null}
                {p.lastError ? <Caption style={{ color: c.danger }}>{p.lastError}</Caption> : null}
              </Card>
            </Section>
          ) : null}

          <Section title="Recent credit activity">
            {usage.error ? <ErrorState error={usage.error} /> : !usage.data ? <SkeletonCards count={3} height={50} /> : usage.data.length === 0 ? <Card><EmptyState icon="list" title="No activity yet" /></Card> : (
              <Group>
                {usage.data.map((u) => (
                  <ListRow key={u.id} title={REASON[u.reason] ?? u.reason.replace(/_/g, ' ')} subtitle={`${u.detail ? `${u.detail} · ` : ''}${ago(u.createdAt)}`}
                    right={<Body style={{ fontWeight: '600', color: u.amount > 0 ? c.success : c.text }}>{u.amount > 0 ? '+' : ''}{u.amount}</Body>} />
                ))}
              </Group>
            )}
          </Section>

          {d.invoices.length ? (
            <Section title="Invoices">
              <Group>
                {d.invoices.map((i) => (
                  <ListRow key={i.id} icon="file-text" title={i.number} subtitle={`${i.description} · ${dateTime(i.paidAt)}`}
                    right={<View style={{ alignItems: 'flex-end' }}><Body>{money(i.totalMinor, i.currency)}</Body>{i.refundedMinor ? <Caption>{money(i.refundedMinor, i.currency)} refunded</Caption> : null}</View>} />
                ))}
              </Group>
            </Section>
          ) : null}
          <Muted style={{ fontSize: 13 }}>A failed build that delivers nothing gets its credits back automatically.</Muted>
        </>
      )}
    </Page>
  );
}
