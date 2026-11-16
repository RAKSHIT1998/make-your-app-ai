import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, EmptyState, ErrorState, ErrorText, Group, Muted, Page, SkeletonCards, ToggleRow, confirmAction, toast } from '@/components/ui';
import { admin, api, isOwner, type AdminFlag } from '@/lib/api';

const label = (k: string) => { const t = k.replace(/_/g, ' ').replace(/\bai\b/, 'AI'); return t[0]!.toUpperCase() + t.slice(1); };

export default function OwnerFlags() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const allowed = isOwner(me.data);
  const q = useQuery({ queryKey: ['admin-flags'], queryFn: admin.flags, enabled: allowed });
  const set = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => admin.setFlag(key, enabled),
    onSuccess: (_d, v) => {
      qc.setQueryData(['admin-flags'], (old: AdminFlag[] | undefined) => old?.map((f) => (f.key === v.key ? { ...f, enabled: v.enabled } : f)));
      void qc.invalidateQueries({ queryKey: ['flags'] });
      toast.success(`${label(v.key)} ${v.enabled ? 'on' : 'off'}`);
    },
  });
  if (me.data && !allowed) return <Page><Card><EmptyState icon="lock" title="Owners only" /></Card></Page>;
  return (
    <Page subtitle="Switching a feature off takes effect for everyone at once and is recorded in the audit log." onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <ErrorText error={set.error} />
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <SkeletonCards count={6} height={56} /> : (
        <Group>
          {q.data.map((f) => (
            <ToggleRow key={f.key} label={label(f.key)} hint={f.description} value={f.enabled} disabled={set.isPending}
              onChange={async (on) => {
                if (!on && !(await confirmAction({ title: `Turn off ${label(f.key).toLowerCase()}?`, body: f.description, confirm: 'Turn off', destructive: true }))) return;
                set.mutate({ key: f.key, enabled: on });
              }} />
          ))}
        </Group>
      )}
      <Muted style={{ fontSize: 13 }}>Defaults are restored only by switching back on.</Muted>
    </Page>
  );
}
