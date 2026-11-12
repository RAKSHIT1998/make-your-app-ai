'use client';

import type { ProjectType } from '@mya/shared';
import { clsx } from 'clsx';
import { PROJECT_TYPE_OPTIONS } from './project-types';

export function TypePicker({ value, onChange }: { value: ProjectType | null; onChange: (t: ProjectType) => void }) {
  return (
    <div role="radiogroup" aria-label="Project type" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {PROJECT_TYPE_OPTIONS.map(({ type, label, description, icon: Icon, available }) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          disabled={!available}
          onClick={() => onChange(type)}
          className={clsx(
            'flex gap-3 rounded-[var(--radius-lg)] border p-4 text-left transition-colors',
            value === type ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:border-brand/50',
            !available && 'cursor-not-allowed opacity-60 hover:border-border',
          )}
        >
          <Icon className={clsx('mt-0.5 size-5 shrink-0', value === type ? 'text-brand' : 'text-muted')} aria-hidden />
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-medium">
              {label}
              {!available && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-normal text-muted">Coming soon</span>}
            </span>
            <span className="mt-0.5 block text-sm text-muted">{description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
