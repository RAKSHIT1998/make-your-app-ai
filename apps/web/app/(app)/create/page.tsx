'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BUSINESS_KITS, type BusinessKit } from '@mya/shared';
import { BedDouble, Boxes, CalendarClock, Contact, Dumbbell, LifeBuoy, Plane, Receipt, ShoppingCart, Utensils, Wrench, Check } from 'lucide-react';
import { Composer } from '@/components/composer';
import { cx } from '@/components/ui';

const KIT_ICONS: Record<BusinessKit['icon'], typeof Contact> = { contact: Contact, 'shopping-cart': ShoppingCart, boxes: Boxes, 'calendar-clock': CalendarClock, receipt: Receipt, 'life-buoy': LifeBuoy, plane: Plane, utensils: Utensils, dumbbell: Dumbbell, wrench: Wrench, bed: BedDouble };

export default function CreatePage() {
  // "Build something like this" from a public page pre-fills the idea (?idea=...).
  const [initial, setInitial] = useState('');
  const [kit, setKit] = useState<BusinessKit | null>(null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const k = BUSINESS_KITS.find((x) => x.id === q.get('kit'));
    if (k) { setKit(k); setInitial(k.prompt); } else setInitial(q.get('idea')?.slice(0, 2000) ?? '');
  }, []);
  const pick = (k: BusinessKit) => {
    setKit(k); setInitial(k.prompt);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div ref={top} className="mx-auto max-w-3xl scroll-mt-6 space-y-8 pt-2 md:pt-10">
      <div className="space-y-2 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">New project</p>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">What do you want to build?</h1>
        <p className="text-sm text-muted">Describe it in your own words. Mention real details — your services, location, audience and the feel you want.</p>
      </div>
      {kit && <p className="text-center text-[13px] text-muted">Starting from the <span className="font-medium text-fg">{kit.name}</span> kit. Edit the description with your business name, products and rules, then build. <button type="button" className="font-medium text-fg underline-offset-4 hover:underline" onClick={() => { setKit(null); setInitial(''); }}>Start blank instead</button></p>}
      <Composer key={`${kit?.id ?? ''}:${initial}`} autoFocus initialIdea={initial} defaultType={kit ? 'saas' : undefined} />
      <section aria-labelledby="kits" className="space-y-3 pt-2">
        <div className="text-center">
          <h2 id="kits" className="text-lg font-semibold tracking-[-0.02em]">Software for your business</h2>
          <p className="mt-1 text-sm text-muted">Pick a ready-made blueprint, make it yours, and build. Only the staff you add can sign in.</p>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {BUSINESS_KITS.map((k) => {
            const Icon = KIT_ICONS[k.icon];
            const on = kit?.id === k.id;
            return (
              <li key={k.id}>
                <button type="button" onClick={() => pick(k)} aria-pressed={on}
                  className={cx('flex h-full w-full gap-3 rounded-[var(--radius-lg)] border bg-surface p-4 text-left shadow-sm transition-colors hover:border-fg/30 focus-visible:outline-2 focus-visible:outline-offset-2', on ? 'border-fg' : 'border-border')}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted"><Icon className="size-4" /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">{k.name}{on && <Check className="size-3.5" aria-label="selected" />}</span>
                    <span className="block text-[13px] text-muted">{k.tagline}</span>
                    <span className="mt-1.5 block text-xs text-subtle">{k.forWho}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-center text-[13px] text-muted">Not sure yet? <Link href="/ideas" className="font-medium text-fg underline-offset-4 hover:underline">Check your idea first</Link>. Prefer a head start? <Link href="/templates" className="font-medium text-fg underline-offset-4 hover:underline">Start from a template</Link> or <Link href="/explore" className="font-medium text-fg underline-offset-4 hover:underline">remix a public project</Link>.</p>
      <ul className="grid grid-cols-1 gap-3 text-[13px] text-muted sm:grid-cols-3">
        <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm"><div className="mb-1 font-semibold text-fg">1 · Plan & design</div>AI turns your idea into pages, sections and a visual system.</li>
        <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm"><div className="mb-1 font-semibold text-fg">2 · Build & check</div>It writes the code and checks its own work before saving.</li>
        <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm"><div className="mb-1 font-semibold text-fg">3 · Refine by chat</div>Ask for changes in plain language. Every change is a version you can undo.</li>
      </ul>
      <p className="text-center text-xs text-subtle">We use clearly marked placeholder text where facts are unknown — never invented reviews, prices or statistics.</p>
    </div>
  );
}
