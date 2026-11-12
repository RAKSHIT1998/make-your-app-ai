'use client';

import { useQuery } from '@tanstack/react-query';
import { Award, Flame, Lock } from 'lucide-react';
import { Card, cx, Skeleton, Tooltip } from './ui';
import { retention, type TimelineItem } from '@/lib/api';
import Link from 'next/link';
import { timeAgo } from './project-card';

/** Streak + badges, computed by the API from real activity only. */
export function ProgressCard() {
  const a = useQuery({ queryKey: ['achievements'], queryFn: retention.achievements });
  if (!a.data) return <Skeleton className="h-44 rounded-[var(--radius-lg)]" />;
  const { streak, badges } = a.data;
  const earned = badges.filter((b) => b.earnedAt).length;
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={cx('flex size-9 items-center justify-center rounded-full', streak.current ? 'bg-accent-soft text-accent-text' : 'bg-surface-muted text-subtle')}><Flame className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{streak.current ? `${streak.current}-day build streak` : 'No streak yet'}</div>
          <div className="text-xs text-muted">{streak.current ? `Longest ${streak.longest} day${streak.longest === 1 ? '' : 's'}` : 'Make an AI change today to start one'}</div>
        </div>
      </div>
      <div className="flex gap-[3px]" aria-label="AI builds over the last 30 days">
        {streak.last30.map((on, i) => <span key={i} className={cx('h-5 flex-1 rounded-[2px]', on ? 'bg-accent' : 'bg-surface-muted')} title={on ? 'Built that day' : undefined} />)}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-[13px]"><span className="font-medium">Badges</span><span className="text-muted tabular-nums">{earned}/{badges.length}</span></div>
        <div className="grid grid-cols-5 gap-2">
          {badges.map((b) => (
            <Tooltip key={b.key} content={`${b.title} — ${b.description}${b.earnedAt ? ` Earned ${new Date(b.earnedAt).toLocaleDateString()}.` : ''}`}>
              <span tabIndex={0} aria-label={`${b.title}${b.earnedAt ? ' (earned)' : ' (locked)'}`} className={cx('flex aspect-square items-center justify-center rounded-[var(--radius-md)] border', b.earnedAt ? 'border-accent/30 bg-accent-soft text-accent-text' : 'border-dashed border-border text-subtle')}>
                {b.earnedAt ? <Award className="size-4" /> : <Lock className="size-3.5" />}
              </span>
            </Tooltip>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function Timeline({ projectId, limit = 12 }: { projectId?: string; limit?: number }) {
  const t = useQuery({ queryKey: ['timeline', projectId ?? 'all', limit], queryFn: () => retention.timeline(projectId, limit) });
  if (!t.data) return <Skeleton className="h-40" />;
  if (!t.data.length) return <p className="text-sm text-subtle">Your building activity will appear here.</p>;
  return (
    <ol className="relative space-y-0.5 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-border">
      {t.data.map((i: TimelineItem) => (
        <li key={i.id} className="relative flex gap-3 rounded-[var(--radius-md)] py-2 pl-0 pr-2">
          <span className={cx('z-10 mt-1 size-[9px] shrink-0 translate-x-[7px] rounded-full ring-4 ring-bg', i.detail?.status === 'failed' ? 'bg-danger' : i.action.startsWith('project.published') ? 'bg-accent' : 'bg-border-strong')} />
          <div className="ml-2 min-w-0 flex-1">
            <div className="text-[13px]"><span className="font-medium">{i.label}</span>{i.project && <> · <Link className="text-muted hover:text-fg hover:underline" href={`/projects/${i.project.id}`}>{i.project.name}</Link></>}</div>
            {i.detail && <div className="truncate text-xs text-subtle">“{i.detail.prompt}”{i.detail.status !== 'succeeded' ? ` · ${i.detail.status.replace('_', ' ')}` : ''}</div>}
            <div className="text-xs text-subtle">{timeAgo(i.at)}{i.actor ? ` · ${i.actor}` : ''}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
