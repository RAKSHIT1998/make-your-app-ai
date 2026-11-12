'use client';

import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Compass, CreditCard, Gift, FolderKanban, Globe, Home, LayoutGrid, LayoutTemplate, LogOut, Monitor, Moon, PanelLeft, Plus, Search, Server, Settings, Shield, ShoppingBag, Smartphone, Sun, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Dialog as D } from 'radix-ui';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Logo, LogoMark } from './logo';
import { Button, cx, Drawer, Kbd, Menu, MenuItem, MenuLabel, MenuSeparator, SoonBadge, Tooltip } from './ui';

interface NavItem { href: string; label: string; icon: LucideIcon; live: boolean; match?: (p: string) => boolean }

const PRIMARY: NavItem[] = [
  { href: '/home', label: 'Home', icon: Home, live: true },
  { href: '/create', label: 'Create', icon: Plus, live: true },
  { href: '/projects', label: 'Projects', icon: FolderKanban, live: true },
];
const STUDIOS: NavItem[] = [
  { href: '/studio/app', label: 'App Studio', icon: Smartphone, live: true },
  { href: '/studio/website', label: 'Website Studio', icon: Globe, live: true },
  { href: '/stores', label: 'Business Studio', icon: ShoppingBag, live: true },
];
const PLATFORM: NavItem[] = [
  { href: '/hosting', label: 'Hosting', icon: Server, live: true },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate, live: false },
];
const COMMUNITY: NavItem[] = [
  { href: '/explore', label: 'Explore', icon: Compass, live: true },
  { href: '/invite', label: 'Invite & earn', icon: Gift, live: true },
];
const ACCOUNT: NavItem[] = [
  { href: '/billing', label: 'Billing', icon: CreditCard, live: true },
  { href: '/settings', label: 'Settings', icon: Settings, live: true },
];
const OWNER: NavItem = { href: '/admin', label: 'Owner console', icon: Shield, live: true };

const isActive = (item: NavItem, path: string) => (item.match ? item.match(path) : path === item.href || path.startsWith(`${item.href}/`));

function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: api.me });
}

function useCredits() {
  return useQuery({ queryKey: ['credits'], queryFn: api.credits });
}

// ───────── Desktop sidebar ─────────

function SideLink({ item, collapsed, path }: { item: NavItem; collapsed: boolean; path: string }) {
  const active = isActive(item, path);
  const Icon = item.icon;
  const body = (
    <span className={cx('flex h-8 items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-[13.5px] font-medium transition-colors', collapsed && 'justify-center px-0', item.live ? (active ? 'bg-surface-muted text-fg shadow-[inset_0_0_0_1px_var(--color-border)]' : 'text-muted hover:bg-surface-muted/70 hover:text-fg') : 'cursor-default text-subtle')}>
      <Icon className={cx('size-4 shrink-0', active && 'text-fg')} aria-hidden />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && !item.live && <SoonBadge />}
    </span>
  );
  const node = item.live ? <Link href={item.href} aria-current={active ? 'page' : undefined}>{body}</Link> : <span aria-disabled title={`${item.label} — coming soon`}>{body}</span>;
  return collapsed ? <Tooltip content={item.live ? item.label : `${item.label} · coming soon`} side="right">{node}</Tooltip> : node;
}

function NavGroup({ title, items, collapsed, path }: { title?: string; items: NavItem[]; collapsed: boolean; path: string }) {
  return (
    <div className="space-y-0.5">
      {title && !collapsed && <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.08em] text-subtle">{title}</div>}
      {title && collapsed && <div className="mx-auto my-3 h-px w-6 bg-border" />}
      {items.map((i) => <SideLink key={i.href} item={i} collapsed={collapsed} path={path} />)}
    </div>
  );
}

function ThemeItems() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <MenuLabel>Theme</MenuLabel>
      {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const).map(([t, label, Icon]) => (
        <MenuItem key={t} icon={<Icon />} onSelect={() => setTheme(t)} shortcut={theme === t ? '✓' : undefined}>{label}</MenuItem>
      ))}
    </>
  );
}

function UserMenu({ collapsed, align = 'start' }: { collapsed?: boolean; align?: 'start' | 'end' }) {
  const me = useMe();
  const router = useRouter();
  const initial = (me.data?.displayName ?? me.data?.email ?? '?').slice(0, 1).toUpperCase();
  return (
    <Menu
      align={align}
      trigger={
        <button className={cx('flex w-full items-center gap-2.5 rounded-[var(--radius-md)] p-1.5 text-left transition-colors hover:bg-surface-muted', collapsed && 'justify-center')} aria-label="Account menu">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg ring-1 ring-border">{initial}</span>
          {!collapsed && <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{me.data?.displayName ?? me.data?.email.split('@')[0] ?? '…'}</span><span className="block truncate text-xs text-subtle">{me.data?.email}</span></span>}
        </button>
      }
    >
      <MenuLabel>{me.data?.email}</MenuLabel>
      <MenuItem icon={<CreditCard />} onSelect={() => router.push('/billing')}>Billing</MenuItem>
      <MenuItem icon={<Settings />} onSelect={() => router.push('/settings')}>Settings</MenuItem>
      <MenuSeparator />
      <ThemeItems />
      <MenuSeparator />
      <MenuItem icon={<LogOut />} onSelect={async () => { await supabase?.auth.signOut(); router.replace('/login'); }}>Sign out</MenuItem>
    </Menu>
  );
}

function CreditsPill({ collapsed }: { collapsed?: boolean }) {
  const credits = useCredits();
  const n = credits.data?.balance;
  return (
    <Tooltip content="AI credits available — manage in Billing" side="right">
      <Link href="/billing" className={cx('flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-2 text-[13px] shadow-sm transition-colors hover:border-border-strong', collapsed && 'justify-center px-0')}>
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        {collapsed ? <span className="font-medium tabular-nums">{n === undefined ? '—' : n >= 1000 ? `${Math.floor(n / 100) / 10}k` : n}</span> : <><span className="text-muted">Credits</span><span className="ml-auto font-medium tabular-nums">{n?.toLocaleString() ?? '—'}</span></>}
      </Link>
    </Tooltip>
  );
}

// ───────── Command palette (⌘K) ─────────

function CommandPalette({ open, onOpenChange, owner }: { open: boolean; onOpenChange: (o: boolean) => void; owner: boolean }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects, enabled: open });
  const go = (href: string) => { onOpenChange(false); router.push(href); };
  const pages = [...PRIMARY, ...STUDIOS, ...COMMUNITY, ...ACCOUNT, ...(owner ? [OWNER] : [])];
  const item = 'flex h-10 cursor-default items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-sm text-fg data-[selected=true]:bg-surface-muted [&>svg]:size-4 [&>svg]:text-muted';
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="animate-fade-in fixed inset-0 z-50 bg-[var(--color-overlay)]" />
        <D.Content className="animate-pop-in fixed left-1/2 top-[12vh] z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-surface shadow-[var(--shadow-overlay)]">
          <D.Title className="sr-only">Command menu</D.Title>
          <D.Description className="sr-only">Search pages, projects and actions</D.Description>
          <Command label="Command menu" loop>
            <div className="flex items-center gap-2 border-b border-border px-4"><Search className="size-4 text-subtle" /><Command.Input autoFocus placeholder="Search pages, projects, actions…" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle" /></div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No results.</Command.Empty>
              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle">
                <Command.Item className={item} onSelect={() => go('/create')}><Plus />New project</Command.Item>
                <Command.Item className={item} onSelect={() => { setTheme('light'); onOpenChange(false); }}><Sun />Light theme</Command.Item>
                <Command.Item className={item} onSelect={() => { setTheme('dark'); onOpenChange(false); }}><Moon />Dark theme</Command.Item>
              </Command.Group>
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle">
                {pages.map((p) => <Command.Item key={p.href} className={item} onSelect={() => go(p.href)}><p.icon />{p.label}</Command.Item>)}
              </Command.Group>
              {projects.data && projects.data.items.length > 0 && (
                <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle">
                  {projects.data.items.slice(0, 20).map((p) => <Command.Item key={p.id} value={`project ${p.name}`} className={item} onSelect={() => go(`/projects/${p.id}`)}><FolderKanban />{p.name}</Command.Item>)}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ───────── Mobile navigation ─────────

function MobileTabs({ path, owner, onCreate }: { path: string; owner: boolean; onCreate: () => void }) {
  const [sheet, setSheet] = useState<null | 'studios' | 'more'>(null);
  const tab = (href: string, label: string, Icon: LucideIcon, active: boolean) => (
    <Link href={href} className={cx('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-fg' : 'text-subtle')} aria-current={active ? 'page' : undefined}>
      <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />{label}
    </Link>
  );
  const sheetLink = (i: NavItem) => i.live ? (
    <Link key={i.href} href={i.href} onClick={() => setSheet(null)} className="flex min-h-12 items-center gap-3 rounded-[var(--radius-md)] px-3 text-[15px] font-medium active:bg-surface-muted"><i.icon className="size-5 text-muted" />{i.label}</Link>
  ) : <div key={i.href} className="flex min-h-12 items-center gap-3 px-3 text-[15px] text-subtle"><i.icon className="size-5" />{i.label}<SoonBadge /></div>;
  const studiosActive = STUDIOS.some((s) => isActive(s, path));
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        <div className="flex h-16 items-stretch">
          {tab('/home', 'Home', Home, isActive(PRIMARY[0]!, path))}
          {tab('/projects', 'Projects', FolderKanban, isActive(PRIMARY[2]!, path))}
          <div className="flex flex-1 items-center justify-center">
            <button onClick={onCreate} aria-label="Create project" className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-fg shadow-[var(--shadow-lg)] active:scale-95"><Plus className="size-6" /></button>
          </div>
          <button onClick={() => setSheet('studios')} className={cx('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium', studiosActive ? 'text-fg' : 'text-subtle')}><LayoutGrid className="size-[22px]" strokeWidth={studiosActive ? 2.2 : 1.8} />Studios</button>
          <button onClick={() => setSheet('more')} className={cx('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium', [...COMMUNITY, ...ACCOUNT].some((a) => isActive(a, path)) || path.startsWith('/admin') ? 'text-fg' : 'text-subtle')}><Settings className="size-[22px]" strokeWidth={1.8} />More</button>
        </div>
      </nav>
      <Drawer open={sheet === 'studios'} onOpenChange={(o) => !o && setSheet(null)} title="Studios" side="bottom">
        <div className="space-y-1">{[...STUDIOS, ...PLATFORM].map(sheetLink)}</div>
      </Drawer>
      <Drawer open={sheet === 'more'} onOpenChange={(o) => !o && setSheet(null)} title="Account" side="bottom">
        <div className="space-y-1">{[...COMMUNITY, ...ACCOUNT, ...(owner ? [OWNER] : [])].map(sheetLink)}</div>
        <MobileThemeRow />
      </Drawer>
    </>
  );
}

function MobileThemeRow() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="mt-3 flex items-center justify-between border-t border-border px-3 pt-4">
      <span className="text-sm text-muted">Theme</span>
      <div className="inline-flex rounded-[var(--radius-md)] bg-surface-muted p-0.5" role="radiogroup" aria-label="Theme">
        {(['light', 'dark', 'system'] as const).map((t) => <button key={t} role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className={cx('h-8 rounded-[calc(var(--radius-md)-2px)] px-3 text-[13px] font-medium capitalize', theme === t ? 'bg-surface shadow-sm' : 'text-muted')}>{t}</button>)}
      </div>
    </div>
  );
}

// ───────── Shell ─────────

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const me = useMe();
  const credits = useCredits();
  const owner = !!me.data && me.data.platformRole !== 'user';
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const workspace = /^\/projects\/[^/]+/.test(path);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('mya-sidebar') === '1');
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = () => setCollapsed((c) => {
    try {
      localStorage.setItem('mya-sidebar', c ? '0' : '1');
    } catch {
      /* ignore */
    }
    return !c;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tablets get the icon rail so content keeps a usable width.
  const [tablet, setTablet] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => setTablet(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const isCollapsed = collapsed || workspace || tablet;
  return (
    <div className="flex min-h-dvh">
      <aside className={cx('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-bg py-3 transition-[width] duration-200 md:flex', isCollapsed ? 'w-[60px] px-2' : 'w-[244px] px-3')}>
        <div className={cx('mb-3 flex items-center', isCollapsed ? 'justify-center' : 'justify-between px-1')}>
          <Link href="/home" aria-label="Make Your App AI home">{isCollapsed ? <LogoMark /> : <Logo />}</Link>
          {!isCollapsed && <Tooltip content={<>Collapse <Kbd>⌘B</Kbd></>}><Button variant="ghost" size="sm" iconOnly onClick={toggle} aria-label="Collapse sidebar"><PanelLeft className="size-4" /></Button></Tooltip>}
        </div>
        <button onClick={() => setPalette(true)} className={cx('mb-2 flex h-8 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-2.5 text-[13px] text-subtle shadow-sm transition-colors hover:border-border-strong', isCollapsed && 'justify-center px-0')} aria-label="Search (⌘K)">
          <Search className="size-4" />{!isCollapsed && <><span className="flex-1 text-left">Search</span><Kbd>⌘K</Kbd></>}
        </button>
        <nav className="flex-1 overflow-y-auto" aria-label="Main">
          <NavGroup items={PRIMARY} collapsed={isCollapsed} path={path} />
          <NavGroup title="Studios" items={STUDIOS} collapsed={isCollapsed} path={path} />
          <NavGroup title="Platform" items={PLATFORM} collapsed={isCollapsed} path={path} />
          <NavGroup title="Community" items={COMMUNITY} collapsed={isCollapsed} path={path} />
          <NavGroup title="Account" items={[...ACCOUNT, ...(owner ? [OWNER] : [])]} collapsed={isCollapsed} path={path} />
        </nav>
        <div className="space-y-2 pt-2">
          {isCollapsed && !workspace && <Tooltip content="Expand sidebar" side="right"><Button variant="ghost" size="sm" iconOnly className="mx-auto flex" onClick={toggle} aria-label="Expand sidebar"><PanelLeft className="size-4" /></Button></Tooltip>}
          <CreditsPill collapsed={isCollapsed} />
          <UserMenu collapsed={isCollapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!workspace && (
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
            <Link href="/home" aria-label="Home"><Logo /></Link>
            <Link href="/billing" className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium tabular-nums shadow-sm"><span className="size-1.5 rounded-full bg-accent" />{credits.data?.balance.toLocaleString() ?? '—'}</Link>
            <button onClick={() => setPalette(true)} className="flex size-9 items-center justify-center rounded-full text-muted" aria-label="Search"><Search className="size-[18px]" /></button>
          </header>
        )}
        <main className={cx('flex-1', workspace ? 'min-h-0' : 'mx-auto w-full max-w-[1160px] px-4 pb-28 pt-6 sm:px-6 md:px-8 md:pb-12 md:pt-8')}>{children}</main>
      </div>

      {!workspace && <MobileTabs path={path} owner={owner} onCreate={() => router.push('/create')} />}
      <CommandPalette open={palette} onOpenChange={setPalette} owner={owner} />
    </div>
  );
}

export function useNavHelpers() {
  return { STUDIOS };
}
