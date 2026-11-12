'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { applyTheme, storedTheme, type Theme } from '@/lib/theme';

export default function SettingsPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => setTheme(storedTheme()), []);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card className="divide-y divide-border">
        <div className="p-5">
          <div className="text-sm text-muted">Email</div>
          <div className="mt-0.5 font-medium">{me.data?.email ?? <Skeleton className="h-5 w-48" />}</div>
        </div>
        <div className="p-5">
          <div className="text-sm text-muted">Workspaces</div>
          <ul className="mt-1 space-y-1">
            {me.data?.organizations.map((o) => (
              <li key={o.id} className="flex justify-between text-sm"><span>{o.name}</span><span className="text-muted">{o.role}</span></li>
            ))}
          </ul>
        </div>
        <div className="p-5">
          <div className="mb-2 text-sm text-muted">Appearance</div>
          <div className="inline-flex rounded-[var(--radius-md)] border border-border p-1" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} onClick={() => { setTheme(t); applyTheme(t); }} className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-sm capitalize ${theme === t ? 'bg-brand-soft font-medium text-brand' : 'text-muted'}`}>{t}</button>
            ))}
          </div>
        </div>
      </Card>
      <Button variant="secondary" onClick={async () => { await supabase?.auth.signOut(); router.replace('/login'); }}>Sign out</Button>
    </div>
  );
}
