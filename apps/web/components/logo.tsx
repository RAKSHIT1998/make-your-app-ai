import { cx } from '@/lib/cx';

/** Brand mark: an ink tile with a geometric "M" and an ember dot ("from anywhere"). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cx('size-7 shrink-0', className)} aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--color-primary)" />
      <path d="M7.5 19.5V9.2c0-.5.6-.8 1-.4l5.5 5.6 5.5-5.6c.4-.4 1-.1 1 .4v10.3" fill="none" stroke="var(--color-primary-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21.6" cy="6.4" r="2.4" fill="var(--color-accent)" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && <span className="text-[15px] font-semibold tracking-[-0.02em]">Make Your App <span className="text-muted">AI</span></span>}
    </span>
  );
}
