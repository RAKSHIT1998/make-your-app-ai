'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, LinkButton, Notice, PageHeader, SectionTitle, Skeleton, Textarea, toast } from '@/components/ui';
import { insights, type IdeaValidation } from '@/lib/api';

const VERDICT = { promising: { label: 'Promising', tone: 'success' }, needs_focus: { label: 'Needs focus', tone: 'warning' }, risky: { label: 'Risky', tone: 'danger' } } as const;

export default function IdeasPage() {
  const qc = useQueryClient();
  const [idea, setIdea] = useState('');
  const [shown, setShown] = useState<IdeaValidation | null>(null);
  const history = useQuery({ queryKey: ['ideas'], queryFn: insights.ideas });
  const run = useMutation({
    mutationFn: () => insights.validateIdea(idea.trim()),
    onSuccess: (r) => { setShown(r); void qc.invalidateQueries({ queryKey: ['ideas'] }); void qc.invalidateQueries({ queryKey: ['credits'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const current = shown;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Idea check" description="Pressure-test an idea before you build it. You get strengths, risks, a first-version scope and a ready-to-use build brief." />
      <Card className="space-y-3">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (idea.trim().length >= 20) run.mutate(); }}>
          <Field label="Your idea" hint="Who is it for, what problem does it solve, and how would it make money? A few sentences is plenty.">
            <Textarea rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={2000} placeholder="A neighbourhood tool library where people reserve drills and ladders for a weekend instead of buying them…" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={run.isPending} disabled={idea.trim().length < 20}><Sparkles className="size-4" />Check my idea</Button>
            <span className="text-xs text-subtle">Uses a few credits. The exact amount is shown after.</span>
          </div>
        </form>
      </Card>
      {run.isPending && <Skeleton className="h-56" />}
      {current && !run.isPending && <Report v={current} />}
      <section>
        <SectionTitle>Earlier checks</SectionTitle>
        {history.error ? <ErrorNotice error={history.error} /> : history.isPending ? <Skeleton className="h-16" /> : history.data.length === 0 ? <EmptyState compact icon={<Lightbulb />} title="Nothing checked yet" body="Your checked ideas will be saved here." /> : (
          <Card padded={false}>
            <ul className="divide-y divide-border">
              {history.data.map((h) => (
                <li key={h.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted" onClick={() => { setShown(h); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{h.report.oneLiner}</span><span className="block truncate text-xs text-subtle">{new Date(h.createdAt).toLocaleDateString()} · {h.creditsCharged} credits</span></span>
                    <Badge tone={VERDICT[h.report.verdict].tone}>{VERDICT[h.report.verdict].label}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h3 className="mb-1.5 text-[13px] font-semibold">{title}</h3><ul className="list-disc space-y-1 pl-5 text-[13px] text-muted marker:text-subtle">{items.map((i) => <li key={i}>{i}</li>)}</ul></div>;
}

function Report({ v }: { v: IdeaValidation }) {
  const r = v.report;
  return (
    <Card className="space-y-5" aria-live="polite">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold tracking-tight">{r.oneLiner}</h2><p className="mt-1 text-sm text-muted">{r.verdictReason}</p></div>
        <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge>
      </div>
      <p className="text-sm"><span className="font-medium">The problem: </span><span className="text-muted">{r.problem}</span></p>
      <div className="grid gap-5 sm:grid-cols-2">
        <List title="Who it’s for" items={r.targetUsers} /><List title="Strengths" items={r.strengths} />
        <List title="Risks" items={r.risks} /><List title="Look at what already exists" items={r.alternativesToResearch} />
        <List title="First-version features" items={r.mvpFeatures} /><List title="Ways it could earn" items={r.monetization} />
      </div>
      <List title="Your first week" items={r.firstWeekSteps} />
      <div className="space-y-2 rounded-[var(--radius-md)] border border-border bg-surface-muted p-3">
        <div className="text-[13px] font-semibold">Build brief</div>
        <p className="text-[13px] text-muted">{r.buildPrompt}</p>
        <LinkButton href={`/create?idea=${encodeURIComponent(r.buildPrompt)}`} size="sm">Start building this</LinkButton>
      </div>
      <Notice tone="info">{v.disclaimer} Charged {v.creditsCharged} credits.</Notice>
    </Card>
  );
}
