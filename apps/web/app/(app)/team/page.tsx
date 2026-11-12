'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, Trash2, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Input, LinkButton, Meter, Notice, PageHeader, SectionTitle, Select, Skeleton, toast, useConfirm } from '@/components/ui';
import { team, type OrgRole, type TeamInvitation } from '@/lib/api';
import { useFlag } from '@/lib/flags';
import { useWorkspace } from '@/lib/use-workspace';

const ROLE_LABEL: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const ROLE_HELP: Record<OrgRole, string> = { owner: 'Full control, including billing', admin: 'Manage members, billing and projects', member: 'Create and edit projects', viewer: 'View only' };
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function TeamPage() {
  const enabled = useFlag('team_workspaces');
  const ws = useWorkspace();
  const orgId = ws.current?.id;
  const overview = useQuery({ queryKey: ['team', orgId], queryFn: () => team.overview(orgId!), enabled: !!orgId });
  if (!enabled) return <Notice tone="warning">Team workspaces are switched off right now.</Notice>;
  if (!ws.ready || overview.isPending) return <div className="space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-40" /></div>;
  if (overview.error) return <ErrorNotice error={overview.error} onRetry={() => overview.refetch()} />;
  const o = overview.data!;
  const admin = o.role === 'owner' || o.role === 'admin';
  return (
    <div className="space-y-8">
      <PageHeader
        title="Team"
        description={o.personal ? 'Your personal workspace is just for you. Create a team workspace to build together.' : `Members of ${o.name} share its projects, credits and plan.`}
      />
      {o.personal ? <PersonalIntro canCreate={o.canCreateWorkspace} /> : <TeamBody orgId={o.id} overview={o} admin={admin} />}
      {o.personal && o.canCreateWorkspace && <CreateWorkspace />}
    </div>
  );
}

function PersonalIntro({ canCreate }: { canCreate: boolean }) {
  return canCreate ? null : (
    <Notice tone="info" action={<LinkButton href="/billing" variant="secondary" size="sm">See plans</LinkButton>}>
      Your plan doesn’t include another team workspace. Upgrade to create one and invite teammates.
    </Notice>
  );
}

function CreateWorkspace() {
  const [name, setName] = useState('');
  const ws = useWorkspace();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => team.create(name.trim()),
    onSuccess: async (o) => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      ws.switchTo(o.id);
      setName('');
      toast.success(`${o.name} created`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <section>
      <SectionTitle>Create a team workspace</SectionTitle>
      <Card>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <Field label="Workspace name" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Acme Studio" /></Field>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}><Users className="size-4" />Create workspace</Button>
        </form>
        <p className="mt-3 text-xs text-subtle">A team workspace has its own plan, credits and projects. You become its owner.</p>
      </Card>
    </section>
  );
}

function TeamBody({ orgId, overview, admin }: { orgId: string; overview: Awaited<ReturnType<typeof team.overview>>; admin: boolean }) {
  const qc = useQueryClient();
  const ws = useWorkspace();
  const confirm = useConfirm();
  const members = useQuery({ queryKey: ['team-members', orgId], queryFn: () => team.members(orgId) });
  const invites = useQuery({ queryKey: ['team-invites', orgId], queryFn: () => team.invitations(orgId), enabled: admin });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['team', orgId] }), qc.invalidateQueries({ queryKey: ['team-members', orgId] }), qc.invalidateQueries({ queryKey: ['team-invites', orgId] })]);
  const setRole = useMutation({ mutationFn: (v: { userId: string; role: OrgRole }) => team.setRole(orgId, v.userId, v.role), onSuccess: () => { toast.success('Role updated'); void refresh(); }, onError: (e) => toast.error((e as Error).message) });
  const remove = useMutation({
    mutationFn: (v: { userId: string; self: boolean }) => team.remove(orgId, v.userId),
    onSuccess: async (_d, v) => {
      if (v.self) {
        await qc.invalidateQueries({ queryKey: ['me'] });
        ws.switchTo(ws.personalOrgId!);
        toast.success('You left the workspace');
      } else { toast.success('Member removed'); void refresh(); }
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const revoke = useMutation({ mutationFn: (id: string) => team.revoke(orgId, id), onSuccess: () => { toast.success('Invitation revoked'); void refresh(); }, onError: (e) => toast.error((e as Error).message) });

  return (
    <>
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2"><div className="text-sm font-medium">{overview.name}</div><Badge>{ROLE_LABEL[overview.role]}</Badge></div>
          <Meter label="Seats in use" value={overview.seats.used + overview.seats.pending} max={overview.seats.limit} />
          <p className="text-xs text-subtle">{overview.seats.used} {overview.seats.used === 1 ? 'member' : 'members'}{overview.seats.pending > 0 ? ` and ${overview.seats.pending} pending ${overview.seats.pending === 1 ? 'invitation' : 'invitations'}` : ''}. Seats come from this workspace’s plan.</p>
          {admin && overview.seats.used + overview.seats.pending >= overview.seats.limit && <Notice tone="warning" action={<LinkButton href="/billing" variant="secondary" size="sm">Upgrade</LinkButton>}>All seats are taken. Upgrade this workspace’s plan to add more people.</Notice>}
        </Card>
        {admin && <InviteForm orgId={orgId} disabled={!overview.canInvite} onDone={refresh} />}
      </section>

      <section>
        <SectionTitle>Members</SectionTitle>
        {members.error ? <ErrorNotice error={members.error} /> : !members.data ? <Skeleton className="h-32" /> : (
          <Card padded={false}>
            <ul className="divide-y divide-border">
              {members.data.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate text-sm font-medium">{m.displayName ?? m.email.split('@')[0]}{m.you && <span className="ml-1.5 text-xs font-normal text-subtle">(you)</span>}</div>
                    <div className="truncate text-xs text-subtle">{m.email} · joined {date(m.joinedAt)}</div>
                  </div>
                  {admin && m.role !== 'owner' && !m.you ? (
                    <Select aria-label={`Role for ${m.email}`} className="!h-8 w-32 text-[13px]" value={m.role} disabled={setRole.isPending} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as OrgRole })}>
                      <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
                    </Select>
                  ) : <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>}
                  {((admin && m.role !== 'owner' && !m.you) || (m.you && m.role !== 'owner')) && (
                    <Button
                      variant="ghost" size="sm" aria-label={m.you ? 'Leave workspace' : `Remove ${m.email}`}
                      onClick={async () => {
                        const ok = await confirm(m.you
                          ? { title: `Leave ${overview.name}?`, body: 'You’ll lose access to its projects. An admin can invite you again.', confirmLabel: 'Leave', danger: true }
                          : { title: `Remove ${m.email}?`, body: 'They lose access to this workspace’s projects immediately.', confirmLabel: 'Remove', danger: true });
                        if (ok.ok) remove.mutate({ userId: m.userId, self: m.you });
                      }}
                    >{m.you ? 'Leave' : <Trash2 className="size-4" />}</Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="mt-2 text-xs text-subtle">{(Object.keys(ROLE_HELP) as OrgRole[]).map((r) => `${ROLE_LABEL[r]}: ${ROLE_HELP[r]}`).join(' · ')}</p>
      </section>

      {admin && (
        <section>
          <SectionTitle>Pending invitations</SectionTitle>
          {invites.error ? <ErrorNotice error={invites.error} /> : !invites.data ? <Skeleton className="h-16" /> : invites.data.length === 0 ? (
            <EmptyState compact icon={<Mail />} title="No pending invitations" body="Invite a teammate by email above." />
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-border">
                {invites.data.map((i: TeamInvitation) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1 basis-48"><div className="truncate text-sm font-medium">{i.email}</div><div className="text-xs text-subtle">{ROLE_LABEL[i.role]} · {i.expired ? 'expired' : `expires ${date(i.expiresAt)}`}</div></div>
                    {i.expired && <Badge tone="warning">Expired</Badge>}
                    <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </>
  );
}

function InviteForm({ orgId, disabled, onDone }: { orgId: string; disabled: boolean; onDone: () => Promise<unknown> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const invite = useMutation({
    mutationFn: () => team.invite(orgId, email.trim(), role),
    onSuccess: (r) => { setLink({ email: r.email, url: r.link }); setEmail(''); void onDone(); },
    onError: (e) => toast.error((e as Error).message),
  });
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success('Invite link copied'); } catch { toast.error('Couldn’t copy — select the link and copy it manually'); }
  }
  return (
    <Card className="space-y-3">
      <div className="text-sm font-medium">Invite a teammate</div>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.mutate(); }}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field label="Email" className="flex-1"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" disabled={disabled} /></Field>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} disabled={disabled}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></Select></Field>
        </div>
        <Button type="submit" loading={invite.isPending} disabled={disabled || !email.trim()}><UserPlus className="size-4" />Create invite link</Button>
        {disabled && <p className="text-xs text-subtle">No free seats. Upgrade the plan or revoke a pending invitation.</p>}
      </form>
      {link && (
        <div className="space-y-2 rounded-[var(--radius-md)] border border-border bg-surface-muted p-3" role="status">
          <div className="text-[13px] font-medium">Invite link for {link.email}</div>
          <div className="flex items-center gap-2">
            <Input readOnly value={link.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button variant="secondary" size="sm" iconOnly aria-label="Copy invite link" onClick={() => copy(link.url)}><Copy className="size-4" /></Button>
          </div>
          <p className="text-xs text-subtle">Send this link to them yourself. It works once, only for that email address, and is shown only now. We don’t send invitation emails yet.</p>
        </div>
      )}
    </Card>
  );
}
