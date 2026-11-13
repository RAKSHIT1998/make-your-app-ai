'use client';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, Play, RotateCw, ShieldCheck } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { showcase } from '@/lib/api';
import { Button, ErrorNotice, Skeleton } from '../ui';

/**
 * Runs a published game or browser app on its public page. Nothing is loaded or run until the visitor presses Play.
 * The code runs in a sandboxed iframe: opaque origin (no access to this site's cookies, storage or session) and a
 * content security policy that blocks all network access. It is always the creator's published version.
 */
export function Player({ slug, title, poster, backend = false }: { slug: string; title: string; poster: ReactNode; backend?: boolean }) {
  const [started, setStarted] = useState(false);
  const [run, setRun] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const q = useQuery({ queryKey: ['play', slug], queryFn: () => showcase.play(slug), enabled: started, retry: false, staleTime: 60_000 });

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[13px] text-muted">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{!started ? (backend ? 'Try it right here' : 'Playable right here') : q.data?.backend ? 'Running in a sandbox. It only talks to this app’s own data.' : 'Running in a sandbox in your browser. No network access.'}</span>
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
              <Button size="lg" onClick={() => setStarted(true)} aria-label={`${backend ? 'Open' : 'Play'} ${title}`}><Play className="size-4" />{backend ? 'Open app' : 'Play'}</Button>
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
