import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
        variant === 'primary' && 'bg-brand text-brand-fg hover:bg-brand-hover',
        variant === 'secondary' && 'border border-border bg-surface text-fg hover:bg-surface-muted',
        variant === 'ghost' && 'text-muted hover:bg-surface-muted hover:text-fg',
        variant === 'danger' && 'bg-danger text-white hover:opacity-90',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-[var(--radius-lg)] border border-border bg-surface', className)}>{children}</div>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('h-11 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 text-[15px] text-fg placeholder:text-subtle focus:border-brand focus:outline-none', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('w-full resize-none rounded-[var(--radius-md)] border border-border bg-surface p-3 text-[15px] leading-relaxed text-fg placeholder:text-subtle focus:border-brand focus:outline-none', props.className)} />;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-surface-muted text-muted',
  generating: 'bg-brand-soft text-brand',
  queued: 'bg-surface-muted text-muted',
  running: 'bg-brand-soft text-brand',
  ready: 'bg-success/10 text-success',
  succeeded: 'bg-success/10 text-success',
  awaiting_approval: 'bg-warning/10 text-warning',
  error: 'bg-danger/10 text-danger',
  failed: 'bg-danger/10 text-danger',
  archived: 'bg-surface-muted text-subtle',
  active: 'bg-success/10 text-success',
  paused: 'bg-warning/10 text-warning',
  paid: 'bg-success/10 text-success',
  pending_payment: 'bg-surface-muted text-muted',
  partially_refunded: 'bg-warning/10 text-warning',
  refunded: 'bg-surface-muted text-muted',
  cancelled: 'bg-surface-muted text-subtle',
  expired: 'bg-surface-muted text-subtle',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[status] ?? 'bg-surface-muted text-muted')}>
      {(status === 'generating' || status === 'running') && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-[var(--radius-md)] bg-surface-muted', className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      {action}
    </div>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{msg}</div>;
}
