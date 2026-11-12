'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Route-level error boundary: the error is logged (and reported once monitoring is configured), never hidden. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Something went wrong</h1>
        <p className="mt-2 max-w-md text-muted">This part of the page failed to load. Your projects and data are safe.{error.digest ? <> Reference: <span className="font-mono text-xs">{error.digest}</span></> : null}</p>
      </div>
      <div className="flex gap-2">
        <button onClick={reset} className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover">Try again</button>
        <Link href="/home" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border bg-surface px-4 text-sm font-medium hover:border-border-strong">Go to Home</Link>
      </div>
    </main>
  );
}
