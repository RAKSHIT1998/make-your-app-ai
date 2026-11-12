'use client';

import type { ReactNode } from 'react';
import { cx } from './core';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Hidden on small screens; the mobile card shows `primary`, `secondary` and `trailing` columns. */
  hideOnMobile?: boolean;
  className?: string;
}

/** Responsive data table: a real table on ≥md, stacked rows on phones. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, selectedKey, mobile, empty }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; selectedKey?: string | null; mobile: { primary: (r: T) => ReactNode; secondary?: (r: T) => ReactNode; trailing?: (r: T) => ReactNode }; empty?: ReactNode }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm">
      <table className="hidden w-full text-sm lg:table">
        <thead>
          <tr className="border-b border-border bg-surface-muted/60 text-left text-xs font-medium text-muted">
            {columns.map((c) => <th key={c.key} scope="col" className={cx('h-9 px-4 font-medium', c.align === 'right' && 'text-right', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-selected={selectedKey === k || undefined}
                className={cx('border-b border-border last:border-0', onRowClick && 'cursor-pointer transition-colors hover:bg-surface-muted/70 focus-visible:bg-surface-muted', selectedKey === k && 'bg-surface-muted')}
              >
                {columns.map((c) => <td key={c.key} className={cx('h-12 px-4', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.cell(r)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="divide-y divide-border lg:hidden">
        {rows.map((r) => {
          const k = rowKey(r);
          const inner = (
            <>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{mobile.primary(r)}</div>{mobile.secondary && <div className="mt-0.5 truncate text-xs text-muted">{mobile.secondary(r)}</div>}</div>
              {mobile.trailing && <div className="shrink-0 text-right text-sm">{mobile.trailing(r)}</div>}
            </>
          );
          return (
            <li key={k}>
              {onRowClick ? <button onClick={() => onRowClick(r)} className={cx('flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-muted', selectedKey === k && 'bg-surface-muted')}>{inner}</button> : <div className="flex min-h-14 items-center gap-3 px-4 py-3">{inner}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
