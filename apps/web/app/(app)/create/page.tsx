'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Composer } from '@/components/composer';

export default function CreatePage() {
  // "Build something like this" from a public page pre-fills the idea (?idea=...).
  const [initial, setInitial] = useState('');
  useEffect(() => { setInitial(new URLSearchParams(window.location.search).get('idea')?.slice(0, 2000) ?? ''); }, []);
  return (
    <div className="mx-auto max-w-3xl space-y-8 pt-2 md:pt-10">
      <div className="space-y-2 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">New project</p>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">What do you want to build?</h1>
        <p className="text-sm text-muted">Describe it in your own words. Mention real details — your services, location, audience and the feel you want.</p>
      </div>
      <Composer key={initial} autoFocus initialIdea={initial} />
      <p className="text-center text-[13px] text-muted">Prefer a head start? <Link href="/templates" className="font-medium text-fg underline-offset-4 hover:underline">Start from a template</Link> or <Link href="/explore" className="font-medium text-fg underline-offset-4 hover:underline">remix a public project</Link>.</p>
      <ul className="grid grid-cols-1 gap-3 text-[13px] text-muted sm:grid-cols-3">
        <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm"><div className="mb-1 font-semibold text-fg">1 · Plan & design</div>AI turns your idea into pages, sections and a visual system.</li>
        <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm"><div className="mb-1 font-semibold text-fg">2 · Build & check</div>It writes the code and checks its own work before saving.</li>
        <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm"><div className="mb-1 font-semibold text-fg">3 · Refine by chat</div>Ask for changes in plain language. Every change is a version you can undo.</li>
      </ul>
      <p className="text-center text-xs text-subtle">We use clearly marked placeholder text where facts are unknown — never invented reviews, prices or statistics.</p>
    </div>
  );
}
