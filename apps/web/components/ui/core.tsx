'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/** Joins class names and resolves Tailwind conflicts so callers can override defaults (e.g. a narrower input). */
export const cx = (...a: ClassValue[]) => twMerge(clsx(a));

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm',
  accent: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface text-fg border border-border hover:border-border-strong hover:bg-surface-muted shadow-sm',
  ghost: 'text-muted hover:text-fg hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
};
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-[var(--radius-sm)]',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-[var(--radius-md)]',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-[var(--radius-md)]',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-[var(--radius-lg)]',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; iconOnly?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, iconOnly, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        iconOnly && (size === 'lg' ? 'w-11 px-0' : size === 'sm' ? 'w-8 px-0' : size === 'xs' ? 'w-7 px-0' : 'w-9 px-0'),
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

const fieldBase = 'w-full rounded-[var(--radius-md)] border border-border bg-surface text-fg placeholder:text-subtle shadow-sm transition-colors hover:border-border-strong focus:border-fg focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={cx(fieldBase, 'h-10 px-3 text-sm', className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} {...p} className={cx(fieldBase, 'resize-none px-3 py-2.5 text-sm leading-relaxed', className)} />;
});

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(fieldBase, 'h-10 px-3 text-sm', className)}>{children}</select>;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block space-y-1.5', className)}>
      <span className="text-[13px] font-medium text-fg">{label}</span>
      {children}
      {error ? <span className="block text-xs text-danger">{error}</span> : hint ? <span className="block text-xs text-subtle">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, children, interactive, padded = true }: { className?: string; children: ReactNode; interactive?: boolean; padded?: boolean }) {
  return (
    <div className={cx('rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm', padded && 'p-5', interactive && 'transition-[border-color,box-shadow,transform] duration-150 hover:border-border-strong hover:shadow-md', className)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-subtle">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{children}</h2>
      {action}
    </div>
  );
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent-text',
};

export function Badge({ tone = 'neutral', children, dot, pulse, className }: { tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium', TONE[tone], className)}>
      {dot && <span className={cx('size-1.5 rounded-full bg-current', pulse && 'animate-pulse')} />}
      {children}
    </span>
  );
}

const STATUS: Record<string, [Tone, string]> = {
  draft: ['neutral', 'Draft'], generating: ['accent', 'Generating'], queued: ['neutral', 'Queued'], running: ['accent', 'Running'],
  ready: ['success', 'Ready'], succeeded: ['success', 'Done'], awaiting_approval: ['warning', 'Needs approval'], error: ['danger', 'Error'],
  failed: ['danger', 'Failed'], archived: ['neutral', 'Archived'], active: ['success', 'Active'], paused: ['warning', 'Paused'],
  paid: ['success', 'Paid'], pending_payment: ['neutral', 'Awaiting payment'], partially_refunded: ['warning', 'Part refunded'],
  refunded: ['neutral', 'Refunded'], cancelled: ['neutral', 'Cancelled'], expired: ['neutral', 'Expired'], fulfilled: ['success', 'Fulfilled'],
  unfulfilled: ['neutral', 'Unfulfilled'], past_due: ['warning', 'Past due'], halted: ['danger', 'Halted'], suspended: ['danger', 'Suspended'],
  building: ['accent', 'Building'], live: ['success', 'Live'], deployed_unverified: ['warning', 'Deployed · not reachable'], rolled_back: ['neutral', 'Previous'],
  pending_verification: ['warning', 'Waiting for DNS'], verified: ['warning', 'Verified · DNS pending'],
};

export function StatusBadge({ status }: { status: string }) {
  const [tone, label] = STATUS[status] ?? (['neutral', status.replaceAll('_', ' ')] as [Tone, string]);
  return <Badge tone={tone} dot pulse={status === 'running' || status === 'generating' || status === 'building'}>{label}</Badge>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-muted px-1 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-[var(--radius-md)] bg-surface-muted', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} aria-label="Loading" />;
}

export function EmptyState({ icon, title, body, action, compact }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14')}>
      {icon && <div className="flex size-10 items-center justify-center rounded-[var(--radius-lg)] border border-border bg-surface text-muted shadow-sm">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{msg}</span>
      {onRetry && <button onClick={onRetry} className="font-medium underline-offset-2 hover:underline">Retry</button>}
    </div>
  );
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warning' | 'success' | 'danger'; children: ReactNode; action?: ReactNode }) {
  const t = tone === 'danger' ? 'border-danger/25 bg-danger-soft text-danger' : tone === 'warning' ? 'border-warning/25 bg-warning-soft text-warning' : tone === 'success' ? 'border-success/25 bg-success-soft text-success' : 'border-border bg-surface-muted text-muted';
  return <div className={cx('flex items-center gap-3 rounded-[var(--radius-md)] border px-3.5 py-3 text-sm', t)}><div className="min-w-0 flex-1">{children}</div>{action}</div>;
}

export function Meter({ label, value, max, format = (n: number) => n.toLocaleString() }: { label: string; value: number; max: number; format?: (n: number) => string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="text-muted">{label}</span><span className="font-medium tabular-nums">{format(value)} <span className="text-subtle">/ {format(max)}</span></span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx('h-full rounded-full transition-[width] duration-500', pct >= 90 ? 'bg-warning' : 'bg-fg')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tracking-[-0.02em] tabular-nums sm:text-2xl">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-subtle">{hint}</div>}
    </div>
  );
}

export function SoonBadge() {
  return <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-subtle">Soon</span>;
}
