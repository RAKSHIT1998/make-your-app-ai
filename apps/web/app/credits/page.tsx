import Link from 'next/link';
import { LEGAL, LEGAL_SLUGS } from '@/lib/legal';

export const metadata = { title: 'Credits', description: 'Open-source software and references used by Make Your App AI.' };

// Kept in step with THIRD_PARTY_NOTICES.md in the repository, which has the full licence texts.
const CREDITS: { name: string; url: string; licence: string; use: string; notice?: string }[] = [
  {
    name: 'Crawl4AI', url: 'https://github.com/unclecode/crawl4ai', licence: 'Apache License 2.0',
    use: 'Reads your current website when you choose “Start from your current website”.',
    notice: 'This product includes software developed by UncleCode (https://x.com/unclecode) as part of the Crawl4AI project (https://github.com/unclecode/crawl4ai).',
  },
  { name: 'Anthropic Skills (frontend-design, theme-factory)', url: 'https://github.com/anthropics/skills', licence: 'Apache License 2.0', use: 'Design guidance for the AI designer and the colour themes in Create.' },
  { name: 'open-hotel-pms', url: 'https://github.com/peeraseepat-cell/open-hotel-pms', licence: 'MIT License', use: 'Informed the Hotel front desk business kit.' },
  { name: 'awesome-freellm-apis', url: 'https://github.com/open-free-llm-api/awesome-freellm-apis', licence: 'MIT License', use: 'Reference list we reviewed when choosing free AI providers.' },
];

export default function CreditsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">← Make Your App AI</Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-[-0.03em]">Credits</h1>
      <p className="mt-2 leading-relaxed text-muted">Make Your App AI is built with, and learns from, open-source work. Thank you to everyone behind these projects.</p>
      <ul className="mt-8 space-y-6">
        {CREDITS.map((c) => (
          <li key={c.name}>
            <h2 className="text-lg font-semibold tracking-[-0.01em]"><a href={c.url} rel="noopener noreferrer" target="_blank" className="underline-offset-4 hover:underline">{c.name}</a></h2>
            <p className="text-sm text-subtle">{c.licence}</p>
            <p className="mt-1 leading-relaxed text-muted">{c.use}</p>
            {c.notice && <p className="mt-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-muted">{c.notice}</p>}
          </li>
        ))}
      </ul>
      <nav className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-6 text-sm">{LEGAL_SLUGS.map((s) => <Link key={s} href={`/legal/${s}`} className="text-muted hover:text-fg">{LEGAL[s]!.title}</Link>)}</nav>
    </main>
  );
}
