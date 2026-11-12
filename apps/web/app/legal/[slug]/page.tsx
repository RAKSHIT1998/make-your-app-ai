import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LEGAL, LEGAL_SLUGS } from '@/lib/legal';

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = LEGAL[slug];
  if (!doc) notFound();
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/pricing" className="text-sm text-brand hover:underline">← Make Your App AI</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{doc.title}</h1>
      <p className="mt-2 rounded-[var(--radius-md)] border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">Draft for legal review — not yet in force. Bracketed items must be completed by the company.</p>
      <div className="mt-8 space-y-6">
        {doc.sections.map(([h, body]) => (
          <section key={h}><h2 className="text-lg font-semibold">{h}</h2><p className="mt-2 whitespace-pre-line leading-relaxed text-muted">{body}</p></section>
        ))}
      </div>
      <nav className="mt-12 flex flex-wrap gap-4 text-sm">{LEGAL_SLUGS.map((s) => <Link key={s} href={`/legal/${s}`} className="text-muted hover:text-fg">{LEGAL[s]!.title}</Link>)}</nav>
    </main>
  );
}
