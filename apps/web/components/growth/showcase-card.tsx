import { Eye, GitFork, Heart } from 'lucide-react';
import Link from 'next/link';
import type { ShowcaseCard as Card } from '@/lib/api';
import { CATEGORY_LABELS } from '@/lib/api';
import { cx } from '../ui/core';

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/**
 * A preview drawn from the project's real published design tokens (palette) and page count.
 * It is deliberately abstract: it isn't presented as a screenshot, because live previews don't exist yet.
 */
export function PalettePreview({ palette, pages, className }: { palette: Record<string, string> | null; pages: number; className?: string }) {
  const p = palette ?? { background: '#F4F3F0', surface: '#FFFFFF', primary: '#0C0C0B', primaryForeground: '#FFFFFF', text: '#0C0C0B', muted: '#8A877F', accent: '#F2541B', border: '#E4E2DD' };
  return (
    <div className={cx('relative overflow-hidden', className)} style={{ background: p.background }} aria-hidden>
      <div className="absolute inset-x-[8%] top-[10%] flex items-center gap-[4%]">
        <span className="h-[7px] w-[18%] rounded-full" style={{ background: p.text, opacity: 0.85 }} />
        <span className="ml-auto h-[5px] w-[10%] rounded-full" style={{ background: p.muted }} />
        <span className="h-[5px] w-[10%] rounded-full" style={{ background: p.muted }} />
        <span className="h-[14px] w-[16%] rounded-[4px]" style={{ background: p.primary }} />
      </div>
      <div className="absolute inset-x-[8%] top-[30%] space-y-[6px]">
        <span className="block h-[10px] w-[62%] rounded-full" style={{ background: p.text }} />
        <span className="block h-[10px] w-[44%] rounded-full" style={{ background: p.text }} />
        <span className="block h-[5px] w-[52%] rounded-full" style={{ background: p.muted }} />
        <span className="mt-[10px] block h-[16px] w-[22%] rounded-[4px]" style={{ background: p.accent }} />
      </div>
      <div className="absolute inset-x-[8%] bottom-[8%] grid grid-cols-3 gap-[4%]">
        {Array.from({ length: Math.min(3, Math.max(1, pages)) }).map((_, i) => <span key={i} className="block h-[34px] rounded-[6px] border" style={{ background: p.surface, borderColor: p.border }} />)}
      </div>
    </div>
  );
}

export function ShowcaseCard({ item }: { item: Card }) {
  return (
    <Link href={`/p/${item.slug}`} className="group block rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">
      <PalettePreview palette={item.palette} pages={item.pageCount} className="aspect-[16/10] rounded-t-[var(--radius-lg)] border-b border-border" />
      <div className="p-4">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</h3>
          {item.featured && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-text">Featured</span>}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{item.description || 'No description yet.'}</p>
        <div className="mt-3 flex items-center gap-3 text-xs text-subtle">
          <span className="min-w-0 truncate">@{item.creator.handle}</span>
          {item.category && <span className="hidden truncate sm:inline">· {CATEGORY_LABELS[item.category]}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2.5 tabular-nums">
            <span className="flex items-center gap-1" title="Likes"><Heart className="size-3.5" />{compact(item.likes)}</span>
            <span className="flex items-center gap-1" title="Views"><Eye className="size-3.5" />{compact(item.views)}</span>
            {item.remixes > 0 && <span className="flex items-center gap-1" title="Remixes"><GitFork className="size-3.5" />{compact(item.remixes)}</span>}
          </span>
        </div>
      </div>
    </Link>
  );
}
