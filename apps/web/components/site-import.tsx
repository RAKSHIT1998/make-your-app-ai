'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { api, type SiteImportResult } from '@/lib/api';
import { Button, ErrorNotice, Field, Input, Spinner } from '@/components/ui';

/**
 * "Start from your current website": reads up to 6 pages of the customer's own site (robots.txt respected) and puts
 * a brief built from their real content into the Create box. Nothing is built or charged until they press Generate.
 * Hidden when the server has no website reader set up.
 */
export function SiteImport({ onBrief }: { onBrief: (brief: string, result: SiteImportResult) => void }) {
  const status = useQuery({ queryKey: ['site-import-status'], queryFn: api.siteImportStatus, staleTime: 5 * 60_000 });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [owner, setOwner] = useState(false);
  const run = useMutation({ mutationFn: () => api.importSite({ url: url.trim(), confirmOwnership: true }), onSuccess: (r) => { onBrief(r.brief, r); setOpen(false); } });

  if (!status.data?.available) return null;
  if (!open) {
    return (
      <p className="text-center text-[13px] text-muted">
        Already have a website?{' '}
        <button type="button" className="inline-flex items-center gap-1 font-medium text-fg underline-offset-4 hover:underline" onClick={() => setOpen(true)}><Globe className="size-3.5" />Start from your current website</button>
      </p>
    );
  }
  return (
    <form
      className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-sm"
      onSubmit={(e) => { e.preventDefault(); if (owner && url.trim()) run.mutate(); }}
      aria-label="Start from your current website"
    >
      <div>
        <h2 className="text-sm font-semibold">Start from your current website</h2>
        <p className="mt-0.5 text-[13px] text-muted">We read up to 6 pages of your site (pages its robots.txt allows) and turn your own words into a description you can edit. The AI then rebuilds it with a fresh design.</p>
      </div>
      <Field label="Your website address">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="www.yourbusiness.com" inputMode="url" autoComplete="url" disabled={run.isPending} />
      </Field>
      <label className="flex items-start gap-2 text-[13px] text-muted">
        <input type="checkbox" className="mt-0.5" checked={owner} onChange={(e) => setOwner(e.target.checked)} disabled={run.isPending} />
        <span>This is my website, or I have permission to reuse its content.</span>
      </label>
      {run.error && <ErrorNotice error={run.error} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!owner || !url.trim() || run.isPending}>{run.isPending ? <><Spinner className="size-3.5" />Reading your site…</> : 'Import'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={run.isPending}>Cancel</Button>
        {run.isPending && <span className="text-xs text-subtle">This can take up to a minute.</span>}
      </div>
    </form>
  );
}
