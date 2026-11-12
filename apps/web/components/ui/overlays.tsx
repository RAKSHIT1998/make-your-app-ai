'use client';

import { Dialog as D, DropdownMenu as M, Tabs as T, Tooltip as TT } from 'radix-ui';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, cx, Input } from './core';

// ───────── Dialog ─────────

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="animate-fade-in fixed inset-0 z-50 bg-[var(--color-overlay)]" />
        <D.Content
          className={cx(
            'animate-pop-in fixed z-50 flex max-h-[calc(100dvh-2rem)] flex-col rounded-[var(--radius-xl)] border border-border bg-surface shadow-[var(--shadow-overlay)] focus:outline-none',
            'inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2',
            size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          )}
        >
          <div className="flex items-start gap-3 px-5 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              <D.Title className="text-base font-semibold tracking-[-0.01em]">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild><Button variant="ghost" size="sm" iconOnly aria-label="Close"><X className="size-4" /></Button></D.Close>
          </div>
          {children && <div className="min-h-0 overflow-y-auto px-5 py-3">{children}</div>}
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ───────── Drawer (side sheet on desktop, bottom sheet on mobile) ─────────

export function Drawer({ open, onOpenChange, title, children, side = 'right' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; side?: 'right' | 'bottom' }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="animate-fade-in fixed inset-0 z-50 bg-[var(--color-overlay)]" />
        <D.Content
          className={cx(
            'fixed z-50 flex flex-col border-border bg-surface shadow-[var(--shadow-overlay)] focus:outline-none',
            side === 'right' ? 'animate-slide-in-right inset-y-0 right-0 w-full max-w-md border-l' : 'animate-slide-in-bottom inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[var(--radius-xl)] border-t pb-[env(safe-area-inset-bottom)]',
          )}
        >
          {side === 'bottom' && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong" aria-hidden />}
          <div className="flex items-center gap-3 px-5 py-4">
            <D.Title className="min-w-0 flex-1 text-base font-semibold">{title}</D.Title>
            <D.Description className="sr-only">{title}</D.Description>
            <D.Close asChild><Button variant="ghost" size="sm" iconOnly aria-label="Close"><X className="size-4" /></Button></D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ───────── Confirm / prompt dialogs (promise-based, replaces window.confirm/prompt) ─────────

interface ConfirmOptions { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean; input?: { label: string; placeholder?: string; required?: boolean; type?: string; defaultValue?: string } }
type Resolver = (v: { ok: boolean; value: string }) => void;
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<{ ok: boolean; value: string }>>(async () => ({ ok: false, value: '' }));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<Resolver | null>(null);
  const ask = useCallback((o: ConfirmOptions) => {
    setValue(o.input?.defaultValue ?? '');
    setOpts(o);
    return new Promise<{ ok: boolean; value: string }>((res) => (resolver.current = res));
  }, []);
  const close = (ok: boolean) => {
    resolver.current?.({ ok, value });
    resolver.current = null;
    setOpts(null);
  };
  const invalid = !!opts?.input?.required && !value.trim();
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Dialog
        open={!!opts}
        onOpenChange={(o) => !o && close(false)}
        title={opts?.title ?? ''}
        description={opts?.body}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => close(false)}>{opts?.cancelLabel ?? 'Cancel'}</Button><Button variant={opts?.danger ? 'danger' : 'primary'} disabled={invalid} onClick={() => close(true)}>{opts?.confirmLabel ?? 'Confirm'}</Button></>}
      >
        {opts?.input && (
          <form onSubmit={(e) => { e.preventDefault(); if (!invalid) close(true); }} className="space-y-1.5">
            <label className="text-[13px] font-medium" htmlFor="confirm-input">{opts.input.label}</label>
            <Input id="confirm-input" autoFocus type={opts.input.type ?? 'text'} placeholder={opts.input.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
          </form>
        )}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);

// ───────── Tooltip ─────────

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TT.Root delayDuration={300}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content side={side} sideOffset={6} className="animate-fade-in z-[60] max-w-xs rounded-[var(--radius-sm)] bg-primary px-2 py-1 text-xs font-medium text-primary-fg shadow-md">
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}
export const TooltipProvider = TT.Provider;

// ───────── Menu (dropdown / context actions) ─────────

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className="animate-pop-in z-50 min-w-48 rounded-[var(--radius-lg)] border border-border bg-surface p-1 shadow-[var(--shadow-lg)]">
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ children, onSelect, danger, icon, shortcut }: { children: ReactNode; onSelect?: () => void; danger?: boolean; icon?: ReactNode; shortcut?: string }) {
  return (
    <M.Item onSelect={onSelect} className={cx('flex h-9 cursor-default select-none items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-sm outline-none data-[highlighted]:bg-surface-muted', danger ? 'text-danger' : 'text-fg')}>
      {icon && <span className="text-muted [&>svg]:size-4">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs text-subtle">{shortcut}</span>}
    </M.Item>
  );
}
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2.5 py-1.5 text-xs text-subtle">{children}</M.Label>;
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />;

// ───────── Tabs ─────────

export function Tabs({ value, onValueChange, items, className, size = 'md' }: { value: string; onValueChange: (v: string) => void; items: { value: string; label: ReactNode; disabled?: boolean; badge?: ReactNode }[]; className?: string; size?: 'sm' | 'md' }) {
  return (
    <T.Root value={value} onValueChange={onValueChange} className={className}>
      <T.List className="flex gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none]" aria-label="Sections">
        {items.map((i) => (
          <T.Trigger
            key={i.value}
            value={i.value}
            disabled={i.disabled}
            className={cx(
              'relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent font-medium text-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:border-fg data-[state=active]:text-fg',
              size === 'sm' ? 'h-9 px-2.5 text-[13px]' : 'h-10 px-3 text-sm',
            )}
          >
            {i.label}
            {i.badge}
          </T.Trigger>
        ))}
      </T.List>
    </T.Root>
  );
}

/** Pill segmented control for small option sets. */
export function Segmented<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius-md)] bg-surface-muted p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cx('h-7 rounded-[calc(var(--radius-md)-2px)] px-3 text-[13px] font-medium transition-all', value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
