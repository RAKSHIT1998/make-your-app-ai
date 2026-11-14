'use client';
import { Card, cx } from './ui';

export type Point = { day: string; value: number };
export const total = (s: Point[]) => s.reduce((n, p) => n + p.value, 0);
export const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A plain daily bar chart. Each bar is focusable and carries its exact value, so nothing depends on colour or hover. */
export function Bars({ title, series, format = (n) => n.toLocaleString(), second }: { title: string; series: Point[]; format?: (n: number) => string; second?: { label: string; series: Point[] } }) {
  const max = Math.max(1, ...series.map((p) => p.value + (second?.series.find((x) => x.day === p.day)?.value ?? 0)));
  const sum = total(series);
  return (
    <Card className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-sm tabular-nums text-muted">{format(sum)}{second ? ` · ${total(second.series).toLocaleString()} ${second.label}` : ''}</span>
      </div>
      {sum === 0 && (!second || total(second.series) === 0) ? <p className="mt-6 pb-6 text-center text-sm text-muted">Nothing in this period yet.</p> : (
        <>
          <ul className="mt-4 flex h-28 items-end gap-px" aria-label={`${title} per day`}>
            {series.map((p) => {
              const b = second?.series.find((x) => x.day === p.day)?.value ?? 0;
              const label = `${dayLabel(p.day)}: ${format(p.value)}${second ? `, ${b} ${second.label}` : ''}`;
              return (
                <li key={p.day} title={label} aria-label={label} tabIndex={0} className="group flex h-full min-w-0 flex-1 flex-col justify-end outline-none">
                  {b > 0 && <span className="w-full rounded-t-[2px] bg-danger/70" style={{ height: `${(b / max) * 100}%` }} />}
                  <span className={cx('w-full bg-fg/80 group-hover:bg-accent group-focus-visible:bg-accent', b > 0 ? '' : 'rounded-t-[2px]')} style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 2 : 0 }} />
                </li>
              );
            })}
          </ul>
          <div className="mt-1.5 flex justify-between text-xs text-subtle"><span>{dayLabel(series[0]!.day)}</span><span>{dayLabel(series.at(-1)!.day)}</span></div>
        </>
      )}
    </Card>
  );
}

export function Breakdown({ title, rows, empty }: { title: string; rows: { label: string; value: number; display?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="min-w-0">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="space-y-2.5 text-sm">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between gap-3"><span className={cx('truncate', !r.label.includes('@') && 'capitalize')}>{r.label}</span><span className="shrink-0 tabular-nums">{r.display ?? r.value.toLocaleString()}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-fg/70" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
