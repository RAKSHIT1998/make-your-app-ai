'use client';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, RotateCw, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
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

  if (q.isLoading) return <div className="p-4"><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <div className="p-4"><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!q.data) return <EmptyState title="Nothing to preview yet" body="Generate your project first." />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{q.data.backend ? 'Preview: test accounts and test data, separate from your published app. Sign-ins reset on restart.' : 'Runs in a sandbox in your browser. No network access.'}</span>
        <Button size="sm" variant="ghost" onClick={() => setRun((n) => n + 1)} aria-label="Restart preview"><RotateCw className="size-3.5" />Restart</Button>
        <Button size="sm" variant="ghost" onClick={() => void frame.current?.requestFullscreen?.()} aria-label="Full screen"><Maximize2 className="size-3.5" />Full screen</Button>
      </div>
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
