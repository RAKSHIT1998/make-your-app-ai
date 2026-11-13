'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Badge, Button, cx, ErrorNotice, Skeleton } from '@/components/ui';
import { insights, type AuditCheck, type AuditSeverity } from '@/lib/api';

const ORDER: AuditSeverity[] = ['fail', 'warn', 'pass'];
const CAT: Record<AuditCheck['category'], string> = { seo: 'SEO', accessibility: 'Accessibility', performance: 'Performance', security: 'Security', mobile: 'Mobile' };
const ICON = { fail: <XCircle className="size-4 text-danger" aria-label="Failed" />, warn: <AlertTriangle className="size-4 text-warning" aria-label="Warning" />, pass: <CheckCircle2 className="size-4 text-success" aria-label="Passed" /> };

/** A static review of the project's current files. It does not measure the live site. */
export function HealthView({ projectId, hasFiles, onOpenFile }: { projectId: string; hasFiles: boolean; onOpenFile: (path: string) => void }) {
  const q = useQuery({ queryKey: ['health', projectId], queryFn: () => insights.health(projectId), enabled: hasFiles });
  if (!hasFiles) return <div className="p-6 text-sm text-muted">Build something first. The health check reads your project’s files.</div>;
  if (q.isPending) return <div className="space-y-2 p-4"><Skeleton className="h-16" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  if (q.error) return <div className="p-4"><ErrorNotice error={q.error} onRetry={() => q.refetch()} /></div>;
  const r = q.data;
  const tone = r.score >= 85 ? 'text-success' : r.score >= 60 ? 'text-warning' : 'text-danger';
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className={cx('text-4xl font-semibold tabular-nums tracking-tight', tone)} aria-label={`Score ${r.score} out of 100`}>{r.score}<span className="text-base font-normal text-subtle">/100</span></div>
        <div className="flex flex-wrap gap-1.5"><Badge tone="danger">{r.summary.fail} to fix</Badge><Badge tone="warning">{r.summary.warn} to review</Badge><Badge tone="success">{r.summary.pass} passing</Badge></div>
        <Button variant="secondary" size="sm" className="ml-auto" loading={q.isFetching} onClick={() => q.refetch()}><RefreshCw className="size-3.5" />Re-check</Button>
      </div>
      <p className="mb-4 text-xs text-subtle">Based on {r.filesScanned} files in the latest version. This is a static review of the code, not a measurement of the live site, so run Lighthouse on the deployed page for real load times.</p>
      {ORDER.map((sev) => {
        const items = r.checks.filter((c) => c.severity === sev);
        if (!items.length) return null;
        return (
          <ul key={sev} className="mb-3 divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface">
            {items.map((c) => (
              <li key={c.id} className="flex gap-3 p-3">
                <span className="mt-0.5 shrink-0">{ICON[c.severity]}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{c.title}<span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-subtle">{CAT[c.category]}</span></div>
                  <p className="text-[13px] text-muted">{c.detail}</p>
                  {c.fix && c.severity !== 'pass' && <p className="text-[13px]"><span className="font-medium">Fix:</span> {c.fix}</p>}
                  {c.files.length > 0 && <div className="flex flex-wrap gap-1.5 pt-0.5">{c.files.map((f) => <button key={f} type="button" onClick={() => onOpenFile(f)} className="max-w-full truncate rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] hover:border-border-strong">{f}</button>)}</div>}
                </div>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
