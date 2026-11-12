'use client';

import { useQuery } from '@tanstack/react-query';
import { Gift, ShieldCheck, UserPlus, Wallet } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorNotice, Notice, PageHeader, SectionTitle, Skeleton, Stat } from '@/components/ui';
import { DataTable } from '@/components/ui/table';
import { ShareButtons } from '@/components/growth/share';
import { referrals } from '@/lib/api';

const STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' }> = { pending: { label: 'Waiting for first payment', tone: 'neutral' }, rewarded: { label: 'Rewarded', tone: 'success' }, rejected: { label: 'Not eligible', tone: 'warning' } };
const REJECT: Record<string, string> = { monthly_cap: 'Monthly reward limit reached', referrer_inactive: 'Your account was inactive', referrer_no_workspace: 'No workspace' };
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function InvitePage() {
  const d = useQuery({ queryKey: ['referrals'], queryFn: referrals.dashboard });
  if (d.error) return <ErrorNotice error={d.error} onRetry={() => d.refetch()} />;
  const url = d.data && typeof window !== 'undefined' ? `${window.location.origin}/r/${d.data.code}` : '';
  return (
    <div className="space-y-8">
      <PageHeader title="Invite & earn" description="Share Make Your App AI. When someone you invite makes their first purchase, you both get bonus credits." />
      {!d.data ? <Skeleton className="h-48" /> : (
        <>
          {!d.data.enabled && <Notice tone="warning">The referral programme is paused. Invites still link, but rewards aren’t paid right now.</Notice>}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card className="space-y-4">
              <div>
                <div className="text-[13px] text-muted">Your invite link</div>
                <div className="mt-1 text-sm">Code <span className="font-mono font-semibold tracking-wider">{d.data.code}</span></div>
              </div>
              <ShareButtons url={url} title="Build apps and websites with AI" />
            </Card>
            <Card className="grid grid-cols-3 gap-4">
              <Stat label="Invited" value={d.data.stats.invited} />
              <Stat label="Converted" value={d.data.stats.converted} />
              <Stat label="Credits earned" value={d.data.stats.creditsEarned.toLocaleString()} />
            </Card>
          </div>

          <section>
            <SectionTitle>How it works</SectionTitle>
            <Card className="grid grid-cols-1 gap-5 text-[13px] text-muted md:grid-cols-3">
              <p className="flex gap-3"><UserPlus className="mt-0.5 size-4 shrink-0 text-fg" /><span><span className="block font-medium text-fg">1. They sign up with your link</span>The invite applies to new accounts within their first days.</span></p>
              <p className="flex gap-3"><Wallet className="mt-0.5 size-4 shrink-0 text-fg" /><span><span className="block font-medium text-fg">2. They make a first purchase</span>Any plan or credit top-up, confirmed by the payment provider.</span></p>
              <p className="flex gap-3"><Gift className="mt-0.5 size-4 shrink-0 text-fg" /><span><span className="block font-medium text-fg">3. You both get credits</span>You get {d.data.rewards.referrer.toLocaleString()} and they get {d.data.rewards.referred.toLocaleString()} credits that never expire.</span></p>
            </Card>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-subtle"><ShieldCheck className="size-3.5" />Up to {d.data.rewards.maxPerMonth} rewarded invites a month. Sign-ups alone don’t earn credits, and self-referrals aren’t eligible.</p>
          </section>

          {d.data.referredBy && <Notice tone="success">You joined through {d.data.referredBy.name}’s invite{d.data.referredBy.status === 'rewarded' ? ` and received ${d.data.referredBy.credits} bonus credits.` : '. Your bonus arrives with your first purchase.'}</Notice>}

          <section>
            <SectionTitle>Your invites</SectionTitle>
            <DataTable
              rows={d.data.referrals}
              rowKey={(r) => r.id}
              empty={<Card padded={false}><EmptyState compact icon={<UserPlus className="size-5" />} title="No invites yet" body="People who sign up with your link appear here." /></Card>}
              columns={[
                { key: 'w', header: 'Person', cell: (r) => <div><div>{r.name ?? r.who}</div>{r.name && <div className="text-xs text-muted">{r.who}</div>}</div> },
                { key: 'j', header: 'Joined', cell: (r) => <span className="text-muted">{date(r.joinedAt)}</span> },
                { key: 's', header: 'Status', cell: (r) => <div><Badge tone={STATUS[r.status]!.tone} dot>{STATUS[r.status]!.label}</Badge>{r.rejectReason && <div className="mt-1 text-xs text-muted">{REJECT[r.rejectReason] ?? r.rejectReason}</div>}</div> },
                { key: 'c', header: 'Your reward', align: 'right', cell: (r) => <span className="tabular-nums">{r.credits ? `+${r.credits}` : '—'}</span> },
              ]}
              mobile={{ primary: (r) => r.name ?? r.who, secondary: (r) => `${date(r.joinedAt)} · ${STATUS[r.status]!.label}`, trailing: (r) => <span className="tabular-nums">{r.credits ? `+${r.credits}` : '—'}</span> }}
            />
          </section>
        </>
      )}
    </div>
  );
}
