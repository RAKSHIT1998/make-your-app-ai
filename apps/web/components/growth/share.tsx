'use client';

import { Check, Copy, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Button, toast } from '../ui';

const enc = encodeURIComponent;

/** Share targets that exist on the web. Instagram has no web share link, so we use the native share sheet or copy. */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const text = `${title} — built with Make Your App AI`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn’t copy — select the link and copy it manually');
    }
  };
  const native = async () => {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); } catch { /* dismissed */ }
    } else {
      await copy();
      toast.message('Paste the link in your Instagram story or bio');
    }
  };
  const targets = [
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
    { label: 'X', href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}` },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{url}</span>
        <Button size="sm" variant="secondary" onClick={copy}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {targets.map((t) => <a key={t.label} href={t.href} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary">{t.label}</Button></a>)}
        <Button size="sm" variant="secondary" onClick={native}><Share2 className="size-3.5" />Instagram & more</Button>
      </div>
    </div>
  );
}
