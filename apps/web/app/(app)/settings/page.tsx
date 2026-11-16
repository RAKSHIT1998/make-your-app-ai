'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Moon, Sun, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, Dialog, ErrorNotice, Field, Input, Kbd, PageHeader, Segmented, Skeleton, Textarea, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <div><div className="text-sm font-medium">{title}</div>{description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  useEffect(() => { if (me.data) { setName(me.data.displayName ?? ''); setHandle(me.data.handle ?? ''); setBio(me.data.bio ?? ''); } }, [me.data]);
  const handleOk = handle === '' || /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(handle);
  const save = useMutation({
    mutationFn: () => api.updateMe({ displayName: name.trim() || null, bio: bio.trim(), ...(handle ? { handle } : {}) }),
    onSuccess: (m) => { qc.setQueryData(['me'], m); toast.success('Profile saved'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const dirty = !!me.data && handleOk && (name.trim() !== (me.data.displayName ?? '') || handle !== (me.data.handle ?? '') || bio.trim() !== (me.data.bio ?? ''));

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Your profile, workspaces and preferences." />
      {me.error ? <ErrorNotice error={me.error} onRetry={() => me.refetch()} /> : null}

      <Card padded={false} className="divide-y divide-border">
        <Row title="Profile" description="How you appear in your workspaces.">
          {!me.data ? <Skeleton className="h-24" /> : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (dirty) save.mutate(); }}>
              <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your name" /></Field>
              <Field label="Creator handle" hint={me.data.handle ? <>Your public profile: <Link className="font-medium text-fg hover:underline" href={`/c/${me.data.handle}`}>/c/{me.data.handle}</Link></> : 'Used on your public profile and published projects.'} error={handleOk ? null : 'Use 3–30 lowercase letters, numbers or hyphens.'}>
                <Input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, ''))} maxLength={30} placeholder="your-name" autoCapitalize="none" spellCheck={false} />
              </Field>
              <Field label="Bio" hint="Shown on your public profile."><Textarea rows={2} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
              <Field label="Email" hint="Managed by your sign-in provider. Never shown publicly."><Input value={me.data.email} readOnly disabled /></Field>
              <Button type="submit" variant="secondary" disabled={!dirty} loading={save.isPending}>Save profile</Button>
            </form>
          )}
        </Row>
        <Row title="Workspaces" description="Projects, credits and billing belong to a workspace.">
          {!me.data ? <Skeleton className="h-12" /> : (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {me.data.organizations.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.personal && <Badge>Personal</Badge>}
                  <span className="capitalize text-muted">{o.role}</span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row title="Appearance" description="Follows your device by default.">
          <Segmented label="Theme" value={theme} onChange={setTheme} options={[
            { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="size-3.5" />System</span> },
            { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-3.5" />Light</span> },
            { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
          ]} />
        </Row>
        <Row title="Keyboard shortcuts" description="Available on desktop.">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-muted">Command palette</dt><dd><Kbd>⌘</Kbd> <Kbd>K</Kbd></dd>
            <dt className="text-muted">Toggle sidebar</dt><dd><Kbd>⌘</Kbd> <Kbd>B</Kbd></dd>
            <dt className="text-muted">Send a prompt</dt><dd><Kbd>⌘</Kbd> <Kbd>↵</Kbd></dd>
          </dl>
        </Row>
        <Row title="Session">
          <Button variant="secondary" onClick={async () => { await supabase?.auth.signOut(); qc.clear(); router.replace('/login'); }}><LogOut className="size-4" />Sign out</Button>
        </Row>
        <Row title="Delete account" description="Permanently removes your account and your own workspaces.">
          <DeleteAccount email={me.data?.email ?? ''} onDeleted={async () => { await supabase?.auth.signOut(); qc.clear(); router.replace('/login'); }} />
        </Row>
      </Card>
    </div>
  );
}

function DeleteAccount({ email, onDeleted }: { email: string; onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const preview = useQuery({ queryKey: ['deletion'], queryFn: api.deletionPreview, enabled: open });
  const del = useMutation({ mutationFn: () => api.deleteAccount(typed.trim()), onSuccess: async () => { toast.success('Your account has been deleted.'); await onDeleted(); } });
  const d = preview.data;
  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <>
      <Button variant="danger" onClick={() => { setTyped(''); setOpen(true); }}><UserX className="size-4" />Delete account…</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Delete your account?" description="This can’t be undone."
        footer={d && !d.blockers.length ? <><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" disabled={!matches} loading={del.isPending} onClick={() => del.mutate()}>Delete account</Button></> : <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>}>
        {preview.error ? <ErrorNotice error={preview.error} onRetry={() => preview.refetch()} /> : !d ? <Skeleton className="h-24" /> : d.blockers.length ? (
          <div className="space-y-2 text-sm">{d.blockers.map((b) => <p key={b}>{b}</p>)}</div>
        ) : (
          <div className="space-y-4 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>Your profile, handle and sign-in</li>
              <li>{d.projects} {d.projects === 1 ? 'project' : 'projects'} in {d.workspaces.length === 1 ? 'your personal workspace' : `${d.workspaces.length} workspaces only you use`}, and their public pages</li>
              <li>Your likes, follows, votes, comments and collections</li>
              {d.subscriptionsToCancel ? <li>Your subscription stops renewing; you won’t be charged again</li> : null}
              <li>You leave any team you belong to; the team keeps its work</li>
            </ul>
            <p className="text-muted">We keep invoices and payment records as tax law requires, without your profile. Orders placed in your shops stay with those orders. Sites deployed to an outside host stay there until you remove them.</p>
            <Field label={`Type ${email} to confirm`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" spellCheck={false} /></Field>
            {del.error ? <ErrorNotice error={del.error} /> : null}
          </div>
        )}
      </Dialog>
    </>
  );
}
