'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Gift, ThumbsUp, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PublicHeader } from '@/components/growth/public-header';
import { PalettePreview } from '@/components/growth/showcase-card';
import { PhaseBadge, nextDeadline, typesText, when } from '@/components/growth/challenge-bits';
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Input, Select, Skeleton, toast, useConfirm } from '@/components/ui';
import { challenges, type ChallengeDetail, type ChallengeEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ChallengePage() {
  const { slug } = useParams<{ slug: string }>();
  const { session } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['challenge', slug, !!session], queryFn: () => challenges.get(slug) });
  const set = (d: ChallengeDetail) => qc.setQueryData(['challenge', slug, !!session], d);
  const vote = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => challenges.vote(slug, id, on),
    onSuccess: set,
    onError: (e) => toast.error((e as Error).message),
  });
  const c = q.data;

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-8 sm:px-6">
        <Link href="/challenges" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" />All challenges</Link>
        {q.error ? <div className="mt-6"><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div> : !c ? <Skeleton className="mt-6 h-64" /> : (
          <div className="mt-4 space-y-8">
            <header className="space-y-3">
              <div className="flex flex-wrap items-center gap-2"><PhaseBadge phase={c.phase} /><span className="text-sm text-muted">{nextDeadline(c)}</span></div>
              <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{c.title}</h1>
              <p className="max-w-3xl whitespace-pre-line text-[15px] leading-relaxed">{c.brief}</p>
              <dl className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-3 pt-2 text-sm sm:grid-cols-4">
                <div><dt className="text-muted">Entries close</dt><dd className="font-medium">{when(c.submissionsCloseAt)}</dd></div>
                <div><dt className="text-muted">Voting closes</dt><dd className="font-medium">{when(c.votingClosesAt)}</dd></div>
                <div><dt className="text-muted">Who can enter</dt><dd className="font-medium">{typesText(c.projectTypes)}</dd></div>
                <div><dt className="text-muted">Votes each</dt><dd className="font-medium tabular-nums">{c.votesPerUser}</dd></div>
              </dl>
              {c.prize && <p className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm"><Gift className="size-4 text-accent" /><span><span className="text-muted">Prize for the top three: </span>{c.prize}</span></p>}
            </header>

            <EnterPanel c={c} signedIn={!!session} onChange={set} />

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{c.phase === 'ended' ? 'Final ranking' : 'Leaderboard'}</h2>
                {session && c.myVotesLeft !== null && (c.phase === 'open' || c.phase === 'voting') && <span className="text-sm text-muted tabular-nums">{c.myVotesLeft} of {c.votesPerUser} votes left</span>}
              </div>
              {c.entries.length === 0 ? (
                <Card><EmptyState compact icon={<Trophy className="size-5" />} title="No entries yet" body={c.phase === 'open' ? 'Be the first: publish a project and enter it above.' : 'Nobody entered this challenge.'} /></Card>
              ) : (
                <ol className="space-y-2.5">
                  {c.entries.map((e) => <EntryRow key={e.id} e={e} c={c} signedIn={!!session} busy={vote.isPending && vote.variables?.id === e.id} onVote={(on) => vote.mutate({ id: e.id, on })} />)}
                </ol>
              )}
              <p className="text-xs text-subtle">Ranked by votes; ties share a place. You can&apos;t vote for your own workspace&apos;s entry, and new accounts can vote one day after signing up.</p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function EntryRow({ e, c, signedIn, busy, onVote }: { e: ChallengeEntry; c: ChallengeDetail; signedIn: boolean; busy: boolean; onVote: (on: boolean) => void }) {
  const votingOpen = c.phase === 'open' || c.phase === 'voting';
  const outOfVotes = !e.votedByMe && c.myVotesLeft === 0;
  return (
    <li className={`flex items-center gap-3 rounded-[var(--radius-lg)] border bg-surface p-3 sm:gap-4 ${e.winner ? 'border-accent' : 'border-border'}`}>
      <span className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums ${e.winner ? 'bg-accent text-white' : 'bg-surface-muted text-muted'}`} aria-label={`Place ${e.rank}`}>{e.winner ? <Trophy className="size-4" /> : e.rank}</span>
      <Link href={`/p/${e.project.slug}`} className="hidden shrink-0 sm:block"><PalettePreview palette={e.project.palette} pages={e.project.pageCount} className="h-14 w-24 rounded-[var(--radius-md)] border border-border" /></Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/p/${e.project.slug}`} className="truncate font-medium hover:underline">{e.project.title}</Link>
          {e.winner && <Badge tone="accent">Winner · #{e.rank}</Badge>}
          {e.mine && <Badge>Yours</Badge>}
        </div>
        <p className="truncate text-[13px] text-muted">by <Link href={`/c/${e.project.creator.handle}`} className="hover:text-fg">{e.project.creator.name}</Link>{e.note && <> · {e.note}</>}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-semibold tabular-nums" aria-label={`${e.votes} votes`}>{e.votes}</span>
        {votingOpen && (signedIn ? (
          <Button size="sm" variant={e.votedByMe ? 'primary' : 'secondary'} loading={busy} disabled={e.mine || outOfVotes} aria-pressed={e.votedByMe} aria-label={e.votedByMe ? `Voted for ${e.project.title} (remove vote)` : `Vote for ${e.project.title}`}
            title={e.mine ? "You can't vote for your own entry" : outOfVotes ? 'Remove a vote to vote for this one' : undefined}
            onClick={() => onVote(!e.votedByMe)}>
            {e.votedByMe ? <Check className="size-4" /> : <ThumbsUp className="size-4" />}<span className="hidden sm:inline">{e.votedByMe ? 'Voted' : 'Vote'}</span>
          </Button>
        ) : <Link href={`/login?next=/challenges/${c.slug}`} aria-label={`Sign in to vote for ${e.project.title}`}><Button size="sm" variant="secondary" tabIndex={-1}><ThumbsUp className="size-4" /><span className="hidden sm:inline">Vote</span></Button></Link>)}
      </div>
    </li>
  );
}

function EnterPanel({ c, signedIn, onChange }: { c: ChallengeDetail; signedIn: boolean; onChange: (d: ChallengeDetail) => void }) {
  const confirm = useConfirm();
  const [projectId, setProjectId] = useState('');
  const [note, setNote] = useState('');
  const open = c.phase === 'open';
  const eligible = useQuery({ queryKey: ['challenge-eligible', c.slug], queryFn: () => challenges.eligible(c.slug), enabled: signedIn && open && !c.myEntry });
  const enter = useMutation({
    mutationFn: () => challenges.enter(c.slug, projectId || eligible.data![0]!.id, note.trim()),
    onSuccess: (d) => { onChange(d); toast.success('You’re in. Share your entry so people can vote for it.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const withdraw = useMutation({ mutationFn: () => challenges.withdraw(c.slug, c.myEntry!), onSuccess: (d) => { onChange(d); toast.success('Entry withdrawn'); }, onError: (e) => toast.error((e as Error).message) });

  if (!open) return null;
  if (!signedIn) return <Card className="flex flex-wrap items-center gap-3"><p className="flex-1 text-sm">Sign in to enter one of your published projects or to vote.</p><Link href={`/login?next=/challenges/${c.slug}`}><Button size="sm">Sign in</Button></Link></Card>;
  if (c.myEntry) {
    const mine = c.entries.find((e) => e.id === c.myEntry);
    return (
      <Card className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm"><span className="font-medium">Your entry is in:</span> {mine?.project.title}. Share its page so people can vote for it.</p>
        <Button size="sm" variant="ghost" loading={withdraw.isPending} onClick={async () => { if ((await confirm({ title: 'Withdraw your entry?', body: 'Its votes are lost. You can enter again while entries are open.', confirmLabel: 'Withdraw', danger: true })).ok) withdraw.mutate(); }}>Withdraw</Button>
      </Card>
    );
  }
  if (eligible.error) return <ErrorNotice error={eligible.error} onRetry={() => eligible.refetch()} />;
  if (!eligible.data) return <Skeleton className="h-24" />;
  if (eligible.data.length === 0) {
    return (
      <Card className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm">To enter, publish a project first ({typesText(c.projectTypes).toLowerCase()}). Entries must be public so people can try them.</p>
        <Link href="/create"><Button size="sm">Build one</Button></Link>
      </Card>
    );
  }
  return (
    <Card>
      <form className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); enter.mutate(); }}>
        <Field label="Your project"><Select id="entry-project" value={projectId || eligible.data[0]!.id} onChange={(e) => setProjectId(e.target.value)}>{eligible.data.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></Field>
        <Field label="A line about it (optional)"><Input id="entry-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What makes it fun?" /></Field>
        <Button type="submit" loading={enter.isPending}>Enter challenge</Button>
      </form>
    </Card>
  );
}
