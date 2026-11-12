'use client';

import { ChevronsUpDown, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFlag } from '@/lib/flags';
import { useWorkspace } from '@/lib/use-workspace';
import { cx, Menu, MenuItem, MenuLabel, MenuSeparator } from './ui';

/** Chooses which workspace every page acts in. Hidden until there's a choice to make. */
export function WorkspaceSwitcher({ collapsed, compact, align = 'start' }: { collapsed?: boolean; compact?: boolean; align?: 'start' | 'end' }) {
  const ws = useWorkspace();
  const router = useRouter();
  const enabled = useFlag('team_workspaces');
  if (!ws.ready || !ws.current || (!enabled && ws.organizations.length < 2)) return null;
  const name = ws.current.personal ? 'Personal' : ws.current.name;
  return (
    <Menu
      align={align}
      trigger={
        <button
          aria-label={`Workspace: ${name}`}
          className={cx('flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface text-[13px] shadow-sm transition-colors hover:border-border-strong', compact ? 'h-9 max-w-[9rem] px-2.5' : 'mb-2 h-8 w-full px-2.5', collapsed && 'justify-center px-0')}
        >
          <span className="flex size-4 shrink-0 items-center justify-center rounded bg-surface-muted text-[10px] font-semibold ring-1 ring-border" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
          {!collapsed && <><span className="min-w-0 flex-1 truncate text-left font-medium">{name}</span><ChevronsUpDown className="size-3.5 shrink-0 text-subtle" aria-hidden /></>}
        </button>
      }
    >
      <MenuLabel>Workspaces</MenuLabel>
      {ws.organizations.map((o) => (
        <MenuItem key={o.id} onSelect={() => ws.switchTo(o.id)} shortcut={o.id === ws.current?.id ? '✓' : undefined}>{o.personal ? 'Personal' : o.name}</MenuItem>
      ))}
      {enabled && <><MenuSeparator /><MenuItem icon={<Users />} onSelect={() => router.push('/team')}>Team &amp; members</MenuItem></>}
    </Menu>
  );
}
