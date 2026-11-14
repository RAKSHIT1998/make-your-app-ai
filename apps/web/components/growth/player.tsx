'use client';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, Play, RotateCw, ShieldCheck } from 'lucide-react';
import { parseCheckoutHandoff } from '@mya/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { showcase } from '@/lib/api';
import { checkoutHref } from '@/lib/shop';
import { Button, ErrorNotice, Skeleton } from '../ui';

/**
 * Runs a published game or browser app on its public page. Nothing is loaded or run until the visitor presses Play.
 * The code runs in a sandboxed iframe: opaque origin (no access to this site's cookies, storage or session) and a
 * content security policy that blocks all network access. It is always the creator's published version.
 */
export function Player({ slug, title, poster, kind = 'game' }: { slug: string; title: string; poster: ReactNode; kind?: 'game' | 'app' | 'shop' }) {
  const label = kind === 'shop' ? { idle: 'Shop right here', verb: 'Open', button: 'Open shop' } : kind === 'app' ? { idle: 'Try it right here', verb: 'Open', button: 'Open app' } : { idle: 'Playable right here', verb: 'Play', button: 'Play' };
  const [started, setStarted] = useState(false);
  const [run, setRun] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const q = useQuery({ queryKey: ['play', slug], queryFn: () => showcase.play(slug), enabled: started, retry: false, staleTime: 60_000 });
  const store = q.data?.store;

  // An online store hands its cart to us for checkout. Only messages from this frame are accepted, the cart is
  // re-validated, and the destination is always this platform's checkout for this project's own store.
  useEffect(() => {
    if (!store) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = parseCheckoutHandoff(e.data);
      if (!h) return;
      try { sessionStorage.setItem(`shop:${store.slug}:back`, window.location.pathname); } catch { /* ignore */ }
      window.location.assign(checkoutHref(store.slug, { items: h.items, ...(h.discountCode ? { discountCode: h.discountCode } : {}), ...(h.shippingId ? { shippingId: h.shippingId } : {}) }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [store]);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[13px] text-muted">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{!started ? label.idle : store ? 'Shop safely: checkout opens on a secure payment page.' : q.data?.backend ? 'Running in a sandbox. It only talks to this app’s own data.' : 'Running in a sandbox in your browser. No network access.'}</span>
        {started && q.data && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setRun((n) => n + 1)}><RotateCw className="size-3.5" />Restart</Button>
            <Button size="sm" variant="ghost" onClick={() => void frame.current?.requestFullscreen?.()}><Maximize2 className="size-3.5" /><span className="hidden sm:inline">Full screen</span></Button>
          </>
        )}
      </div>
      <div className="relative h-[min(72dvh,640px)] w-full bg-surface-muted">
        {!started ? (
          <>
            <div className="absolute inset-0 opacity-60" aria-hidden>{poster}</div>
            <div className="absolute inset-0 flex items-center justify-center bg-bg/40">
              <Button size="lg" onClick={() => setStarted(true)} aria-label={`${label.verb} ${title}`}><Play className="size-4" />{label.button}</Button>
            </div>
          </>
        ) : q.isLoading ? <Skeleton className="absolute inset-0 size-full rounded-none" />
          : q.isError ? <div className="p-4"><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>
          : q.data ? (
            <iframe
              key={run}
              ref={frame}
              title={title}
              sandbox="allow-scripts allow-forms allow-pointer-lock"
              allow="fullscreen"
              srcDoc={q.data.html}
              className="absolute inset-0 size-full bg-white"
              onLoad={() => frame.current?.focus()}
            />
          ) : null}
      </div>
    </div>
  );
}
