export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--color-brand)" />
        <path d="M7 16V8l5 5 5-5v8" fill="none" stroke="var(--color-brand-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Make Your App AI
    </span>
  );
}
