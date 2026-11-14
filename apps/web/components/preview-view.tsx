'use client';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, RotateCw, ShieldCheck } from 'lucide-react';
import { parseCheckoutHandoff } from '@mya/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { checkoutHref } from '@/lib/shop';
import { Button, EmptyState, ErrorNotice, Skeleton } from './ui';

/**
 * Runs a static HTML/CSS/JS project (games, browser apps) in a sandboxed iframe.
 * `sandbox` without allow-same-origin gives the page an opaque origin, so it cannot read the app's cookies,
 * tokens or storage; the injected CSP blocks all network access. The code runs in this browser tab only, never on our servers.
 */
export function PreviewView({ projectId, stamp }: { projectId: string; stamp: string }) {
  const [run, setRun] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const q = useQuery({ queryKey: ['preview', projectId, stamp], queryFn: () => api.preview(projectId), retry: false });
  const store = q.data?.store;
  const [handoff, setHandoff] = useState<string | null>(null);
  // In the builder, a shop's Checkout button doesn't leave the workspace: we show where it would go.
  useEffect(() => {
    if (!store) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = parseCheckoutHandoff(e.data);
      if (h) setHandoff(checkoutHref(store.slug, { items: h.items, ...(h.discountCode ? { discountCode: h.discountCode } : {}), ...(h.shippingId ? { shippingId: h.shippingId } : {}) }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [store]);

  if (q.isLoading) return <div className="p-4"><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <div className="p-4"><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!q.data) return <EmptyState title="Nothing to preview yet" body="Generate your project first." />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{store ? (store.live ? 'Preview of your shop with your real products.' : 'Preview of your shop with your products. The store is a draft: shoppers can’t see it yet.') : q.data.backend ? 'Preview: test accounts and test data, separate from your published app. Sign-ins reset on restart.' : 'Runs in a sandbox in your browser. No network access.'}</span>
        <Button size="sm" variant="ghost" onClick={() => setRun((n) => n + 1)} aria-label="Restart preview"><RotateCw className="size-3.5" />Restart</Button>
        <Button size="sm" variant="ghost" onClick={() => void frame.current?.requestFullscreen?.()} aria-label="Full screen"><Maximize2 className="size-3.5" />Full screen</Button>
      </div>
      {handoff && store && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-2 text-xs text-fg" role="status">
          <span className="min-w-0 flex-1">{store.live ? 'Checkout works. Shoppers go to your secure checkout page to pay.' : 'Checkout works once your store is live. Add products and payments, then set the store live in Business Studio.'}</span>
          {store.live ? <a href={handoff} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">Open checkout</a> : <Link href="/stores" className="font-medium underline-offset-4 hover:underline">Open Business Studio</Link>}
          <button type="button" className="text-muted hover:text-fg" onClick={() => setHandoff(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {q.data.warnings.length > 0 && <p className="shrink-0 border-b border-border bg-warning-soft px-3 py-1.5 text-xs text-fg">{q.data.warnings.join(' · ')}</p>}
      <iframe
        key={run}
        ref={frame}
        title="Live preview"
        sandbox="allow-scripts allow-forms allow-pointer-lock"
        allow="fullscreen"
        srcDoc={q.data.html}
        className="min-h-0 w-full flex-1 bg-white"
        onLoad={() => frame.current?.focus()}
      />
    </div>
  );
}
