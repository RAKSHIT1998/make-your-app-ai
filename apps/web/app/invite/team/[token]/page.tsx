'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { Button, Card, ErrorNotice, LinkButton, Notice, Skeleton, toast } from '@/components/ui';
import { ApiError, team } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setActiveOrg } from '@/lib/workspace';

export default function AcceptTeamInvite() {
  const { token } = useParams<{ token: string }>();
  const { session, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const preview = useQuery({ queryKey: ['team-invite', token], queryFn: () => team.preview(token), retry: false });
  const accept = useMutation({
    mutationFn: () => team.accept(token),
    onSuccess: async (r) => {
      setActiveOrg(r.organizationId);
      qc.removeQueries();
      toast.success(`You joined ${r.name}`);
      router.replace('/team');
    },
  });
  const err = preview.error instanceof ApiError ? preview.error : null;
  const here = `/invite/team/${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" aria-label="Make Your App AI home"><Logo /></Link>
      {preview.isPending ? <Skeleton className="h-48" /> : err ? (
        <Card className="space-y-2 text-center">
          <h1 className="text-lg font-semibold">{err.status === 410 ? 'This invitation has expired' : 'This invitation isn’t valid'}</h1>
          <p className="text-sm text-muted">{err.status === 410 ? 'Ask a workspace admin to send you a new link.' : 'It may have been used, revoked or mistyped. Ask a workspace admin for a new link.'}</p>
          <LinkButton href="/home" variant="secondary">Go to your workspace</LinkButton>
        </Card>
      ) : preview.error ? <ErrorNotice error={preview.error} onRetry={() => preview.refetch()} /> : (
        <Card className="space-y-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted ring-1 ring-border"><Users className="size-5" /></span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Join {preview.data.organizationName}</h1>
            <p className="mt-1 text-sm text-muted">You’re invited as {preview.data.role === 'admin' ? 'an' : 'a'} <span className="font-medium text-fg">{preview.data.role}</span>. This invitation is for <span className="font-mono">{preview.data.emailHint}</span>.</p>
          </div>
          {accept.error && <Notice tone="danger">{(accept.error as Error).message}</Notice>}
          {loading ? <Skeleton className="h-10" /> : session ? (
            <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>Accept invitation</Button>
          ) : (
            <div className="space-y-2">
              <LinkButton className="w-full" href={`/login?next=${encodeURIComponent(here)}`}>Sign in to accept</LinkButton>
              <p className="text-center text-xs text-subtle">Use the account with the email address this invitation was sent to.</p>
            </div>
          )}
        </Card>
      )}
    </main>
  );
}
