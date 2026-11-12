'use client';

import type { ProjectType } from '@mya/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronDown, Lock, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFlag } from '@/lib/flags';
import { VoiceButton } from './voice-button';
import { api, ApiError, billing } from '@/lib/api';
import { PROJECT_TYPE_OPTIONS } from './project-types';
import { Button, cx, Dialog, ErrorNotice, Field, Input, Kbd, Select, toast } from './ui';

const EXAMPLES: Record<string, string[]> = {
  website: ['A portfolio for a wedding photographer with packages, a gallery and an enquiry form', 'A landing page for a yoga studio in Pune with class timings and pricing'],
  business_website: ['A website for our dental clinic in Jammu with services, doctors and appointment enquiries', 'A boutique lakeside hotel site with rooms, a gallery and WhatsApp enquiries'],
  ecommerce: ['A premium dry fruit store with packaging sizes, coupons and Razorpay checkout'],
  mobile_app: ['A fitness app with workout plans, a progress log and an exercise library', 'A café app with our menu, opening hours and a table-booking request form'],
  saas: ['A CRM for small agencies with clients, deals and a sales pipeline'],
  custom_software: ['An inventory tool for a pharmacy with stock alerts and supplier orders'],
};

const STRUCTURE = `\n\nWho it's for: \nPages / sections: \nStyle: \nMust-haves: `;

export function Composer({ autoFocus, compact, types, defaultType = 'website', initialIdea = '' }: { autoFocus?: boolean; compact?: boolean; types?: ProjectType[]; defaultType?: ProjectType; initialIdea?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [type, setType] = useState<ProjectType>(defaultType);
  const [idea, setIdea] = useState(initialIdea);
  const [name, setName] = useState('');
  const [tone, setTone] = useState('');
  const [color, setColor] = useState('');
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const planAllowed = useFlag('plan_first_builder');
  const [planFirst, setPlanFirst] = useState(true);
  const usePlan = planAllowed && planFirst;
  const overview = useQuery({ queryKey: ['billing'], queryFn: billing.overview });
  const estimate = useQuery({ queryKey: ['estimate'], queryFn: api.estimate });
  const allowed = new Set(overview.data?.entitlements.projectTypes ?? ['website', 'business_website']);

  const prompt = () => {
    const prefs = [tone && `Visual style: ${tone}`, color && `Brand colour: ${color}`].filter(Boolean).join('. ');
    return `${idea.trim()}${prefs ? `\n\nPreferences: ${prefs}.` : ''}`;
  };
  const projectName = () => name.trim() || idea.trim().split(/[.,\n]/)[0]!.slice(0, 60) || 'Untitled project';

  const create = useMutation({
    mutationFn: async () => {
      const project = await api.createProject({ name: projectName(), type, description: idea.trim().slice(0, 4000) });
      try {
        await api.generate(project.id, prompt(), { mode: usePlan ? 'plan' : 'build' });
      } catch (e) {
        // Project exists even if generation could not start; open it so the user can retry.
        router.push(`/projects/${project.id}`);
        throw e;
      }
      return project;
    },
    onSuccess: (p) => {
      for (const k of ['projects', 'activity', 'credits', 'billing']) void qc.invalidateQueries({ queryKey: [k] });
      router.push(`/projects/${p.id}`);
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(e instanceof Error ? e.message : 'Could not start generation');
    },
  });

  const valid = idea.trim().length >= 10;
  const est = estimate.data;
  const typical = est?.typical.create;
  const openConfirm = () => valid && setConfirm(true);
  const needsUpgrade = create.error instanceof ApiError && create.error.status === 402;

  return (
    <div className="space-y-4">
      <div className={cx('group rounded-[var(--radius-xl)] border border-border bg-surface shadow-[var(--shadow-md)] transition-[border-color,box-shadow] focus-within:border-border-strong focus-within:shadow-[var(--shadow-lg)]')}>
        <label htmlFor="composer" className="sr-only">Describe your idea</label>
        <textarea
          id="composer"
          autoFocus={autoFocus}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openConfirm(); } }}
          rows={compact ? 3 : 5}
          maxLength={8000}
          placeholder="Describe your idea. We'll turn it into a working product."
          className="block w-full resize-none rounded-t-[var(--radius-xl)] bg-transparent px-5 pb-2 pt-4 text-[15px] leading-relaxed outline-none placeholder:text-subtle sm:text-base"
        />
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setIdea((v) => (v.includes("Who it's for:") ? v : `${v.trimEnd()}${STRUCTURE}`))} title="Adds a short structure to help you describe the essentials">
            <Wand2 className="size-4" />Add structure
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPrefsOpen((o) => !o)} aria-expanded={prefsOpen}>
            Preferences<ChevronDown className={cx('size-3.5 transition-transform', prefsOpen && 'rotate-180')} />
          </Button>
          <VoiceButton onText={(t) => setIdea((v) => (v.trim() ? `${v.trimEnd()} ${t}` : t))} />
          {planAllowed && (
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 text-[13px] text-muted hover:text-fg" title="The AI drafts a plan and asks a few questions before writing code">
              <input type="checkbox" className="size-3.5 accent-[var(--color-primary)]" checked={planFirst} onChange={(e) => setPlanFirst(e.target.checked)} />Plan first
            </label>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-subtle sm:inline">{idea.length > 0 && !valid ? 'A little more detail…' : <><Kbd>⌘</Kbd> <Kbd>↵</Kbd></>}</span>
            <Button size="md" onClick={openConfirm} disabled={!valid} aria-label="Generate"><ArrowUp className="size-4" /><span className="hidden sm:inline">Generate</span></Button>
          </div>
        </div>
        {prefsOpen && (
          <div className="grid grid-cols-1 gap-3 border-t border-border px-5 py-4 sm:grid-cols-3">
            <Field label="Project name" hint="Optional"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grand Lake Hotel" maxLength={80} /></Field>
            <Field label="Visual style"><Select value={tone} onChange={(e) => setTone(e.target.value)}><option value="">Let AI decide</option>{['Minimal and clean', 'Bold and modern', 'Elegant and premium', 'Warm and friendly', 'Playful and colourful'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Brand colour" hint="Optional">
              <div className="flex gap-2"><input type="color" aria-label="Pick brand colour" value={color || '#111111'} onChange={(e) => setColor(e.target.value)} className="h-10 w-12 cursor-pointer rounded-[var(--radius-md)] border border-border bg-surface p-1" /><Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#0F4C5C" /></div>
            </Field>
          </div>
        )}
      </div>

      <div role="radiogroup" aria-label="Project type" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {PROJECT_TYPE_OPTIONS.filter((o) => !types || types.includes(o.type)).map(({ type: t, label, icon: Icon, available }) => {
          const locked = available && !allowed.has(t);
          const on = type === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!available}
              onClick={() => setType(t)}
              className={cx('inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors', on ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-fg', !available && 'cursor-not-allowed opacity-50 hover:border-border hover:text-muted')}
            >
              <Icon className="size-4" aria-hidden />{label}
              {!available && <span className="text-[10px] uppercase tracking-wide">soon</span>}
              {locked && <Lock className="size-3" aria-label="Needs a higher plan" />}
            </button>
          );
        })}
      </div>

      {!compact && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(EXAMPLES[type] ?? []).map((ex) => (
            <button key={ex} onClick={() => setIdea(ex)} className="flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-dashed border-border px-3.5 py-3 text-left text-[13px] text-muted transition-colors hover:border-border-strong hover:bg-surface hover:text-fg">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />{ex}
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={usePlan ? 'Draft a plan first?' : 'Start generating?'}
        description={usePlan ? 'AI will draft a plan — pages, features, assumptions — and ask any questions that matter. No code is written until you approve the plan.' : 'AI will plan, design and write your project, then run its checks on the result. You can edit everything afterwards.'}
        footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Back</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!allowed.has(type)}>{usePlan ? 'Draft plan' : 'Generate project'}</Button></>}
      >
        <dl className="divide-y divide-border rounded-[var(--radius-lg)] border border-border text-sm">
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Type</dt><dd className="font-medium">{PROJECT_TYPE_OPTIONS.find((o) => o.type === type)?.label}</dd></div>
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Name</dt><dd className="truncate font-medium">{projectName()}</dd></div>
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Estimated usage</dt><dd className="text-right font-medium">{usePlan ? 'A small part of a full build' : typical ? `~${typical.median} credits (up to ${Math.min(typical.p90, est!.maxCreditsPerRun)})` : est ? `Up to ${est.maxCreditsPerRun} credits` : '…'}</dd></div>
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">Available</dt><dd className="font-medium tabular-nums">{est?.balance.toLocaleString() ?? '…'} credits</dd></div>
        </dl>
        {!allowed.has(type) && <p className="mt-3 text-sm text-warning">Your plan doesn&apos;t include this project type. <Link href="/billing" className="font-medium underline">See plans</Link></p>}
        {typical === null && est && <p className="mt-3 text-xs text-subtle">Estimates appear once enough projects have been generated. You&apos;re only charged for what the AI actually uses; a run stops at your plan&apos;s per-run cap.</p>}
        {create.error && !needsUpgrade ? <div className="mt-3"><ErrorNotice error={create.error} /></div> : null}
      </Dialog>
    </div>
  );
}
