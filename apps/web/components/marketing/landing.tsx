'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, Check, Code2, Compass, Globe, LayoutTemplate, MessageSquare, Rocket, ShoppingBag, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShowcaseCard } from '@/components/growth/showcase-card';
import { PublicHeader } from '@/components/growth/public-header';
import { VoiceButton } from '@/components/voice-button';
import { Button } from '@/components/ui';
import { LEGAL, LEGAL_SLUGS } from '@/lib/legal';
import { showcase } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const EXAMPLES = ['A website for my dental clinic with services and appointment requests', 'A café app with our menu and table bookings', 'A portfolio for my wedding photography'];

export function Landing() {
  const { session } = useAuth();
  const router = useRouter();
  const [idea, setIdea] = useState('');
  // Real public projects only; the section hides when there are none.
  const featured = useQuery({ queryKey: ['landing-showcase'], queryFn: async () => { const f = await showcase.explore({ sort: 'featured', limit: 6 }); return f.items.length ? f.items : (await showcase.explore({ sort: 'trending', limit: 6 })).items; }, retry: false });
  const start = () => {
    const target = `/create${idea.trim() ? `?idea=${encodeURIComponent(idea.trim().slice(0, 1500))}` : ''}`;
    router.push(session ? target : `/login?next=${encodeURIComponent(target)}`);
  };

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main>
        <section className="mx-auto max-w-3xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <p className="text-sm font-medium text-accent-text">Build anything. From anywhere.</p>
          <h1 className="mt-4 text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">Your idea deserves to exist.<br className="hidden sm:block" /> Build it with AI.</h1>
          <p className="mx-auto mt-5 max-w-xl text-[17px] text-muted">Describe a website, app or online store in your own words. Get real, editable code you own — then publish, share and keep improving it by chatting.</p>
          <form className="mx-auto mt-9 max-w-2xl rounded-[var(--radius-xl)] border border-border bg-surface text-left shadow-[var(--shadow-lg)] focus-within:border-border-strong" onSubmit={(e) => { e.preventDefault(); start(); }}>
            <label htmlFor="landing-idea" className="sr-only">Describe your idea</label>
            <textarea id="landing-idea" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start(); }}
              placeholder="Describe your idea. We'll turn it into a working product." className="block w-full resize-none bg-transparent px-5 pt-4 text-base outline-none placeholder:text-subtle" />
            <div className="flex items-center gap-2 px-3 pb-3">
              <VoiceButton onText={(t) => setIdea((v) => (v.trim() ? `${v.trimEnd()} ${t}` : t))} />
              <span className="hidden text-xs text-subtle sm:inline">Free to start · no card needed</span>
              <Button type="submit" size="md" className="ml-auto"><ArrowUp className="size-4" />Start building</Button>
            </div>
          </form>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((e) => <button key={e} onClick={() => setIdea(e)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-fg">{e}</button>)}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <Link href={session ? '/templates' : '/login?next=%2Ftemplates'} className="inline-flex items-center gap-1.5 text-muted hover:text-fg"><LayoutTemplate className="size-4" />Start from a template</Link>
            <Link href="/explore" className="inline-flex items-center gap-1.5 text-muted hover:text-fg"><Compass className="size-4" />Explore what others built</Link>
          </div>
        </section>

        <section className="border-y border-border bg-surface/60">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
            {[
              { icon: MessageSquare, t: 'Describe it', b: 'Say what you want in plain language — or speak it. The AI drafts a plan and asks only the questions that matter.' },
              { icon: Code2, t: 'Get real code', b: 'Specialised AI agents plan, design and write your project, check their own work, and save every change as a version you can restore.' },
              { icon: Rocket, t: 'Launch and grow', b: 'Deploy to your own domain, publish to Explore, take orders and payments, and keep improving it by chatting.' },
            ].map(({ icon: Icon, t, b }) => (
              <div key={t}>
                <span className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted"><Icon className="size-4" /></span>
                <h2 className="mt-4 font-semibold">{t}</h2>
                <p className="mt-1.5 text-sm text-muted">{b}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-[-0.02em]">What you can build today</h2>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Globe, t: 'Websites', b: 'Business sites, portfolios and landing pages with SEO built in.' },
              { icon: Smartphone, t: 'Mobile apps', b: 'iOS and Android apps in React Native (Expo) that you build with your own accounts.' },
              { icon: ShoppingBag, t: 'Online stores', b: 'Products, inventory, orders, discounts and payments through your own Razorpay or Stripe.' },
              { icon: Rocket, t: 'Hosting', b: 'One-click deploys, rollbacks, environment variables and custom domains with SSL.' },
            ].map(({ icon: Icon, t, b }) => (
              <div key={t} className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-sm">
                <Icon className="size-5 text-accent-text" />
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 text-[13px] text-muted">{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-subtle">SaaS platforms and custom business software are on the way.</p>
        </section>

        {featured.data && featured.data.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
            <div className="flex items-end justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">Made with Make Your App AI</h2>
              <Link href="/explore" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted hover:text-fg">Explore all<ArrowRight className="size-3.5" /></Link>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{featured.data.slice(0, 6).map((i) => <ShowcaseCard key={i.slug} item={i} />)}</div>
          </section>
        )}

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="flex flex-col items-start gap-6 rounded-[var(--radius-xl)] bg-[#0C0C0B] px-6 py-10 text-[#F3F2EF] sm:px-10 md:flex-row md:items-center">
            <div className="flex-1">
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">Start free. Upgrade when you launch.</h2>
              <ul className="mt-4 grid grid-cols-1 gap-2 text-sm text-[#F3F2EF]/75 sm:grid-cols-2">
                {['You own your code — download it any time', 'Clear credit pricing, no surprise charges', 'Every change versioned, one-click restore', 'Payments confirmed by the provider, never the browser'].map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#FF6A33]" />{x}</li>)}
              </ul>
            </div>
            <div className="flex gap-2">
              <Link href={session ? '/create' : '/login'}><Button className="bg-[#F3F2EF] text-[#0C0C0B] hover:bg-white">Start building</Button></Link>
              <Link href="/pricing"><Button variant="ghost" className="text-[#F3F2EF] hover:bg-white/10">See pricing</Button></Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} Make Your App AI</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2"><Link href="/explore" className="hover:text-fg">Explore</Link><Link href="/pricing" className="hover:text-fg">Pricing</Link>{LEGAL_SLUGS.map((s) => <Link key={s} href={`/legal/${s}`} className="hover:text-fg">{LEGAL[s]!.title}</Link>)}</nav>
        </div>
      </footer>
    </div>
  );
}
