import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, Caption, Card, ErrorState, ErrorText, Field, H3, Icon, Muted, Page, Row, SkeletonCards, confirmAction, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import { usePrefs } from '@/lib/prefs';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function DeleteAccount() {
  const { c } = useTheme();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const preview = useQuery({ queryKey: ['deletion'], queryFn: api.deletionPreview });
  const setWorkspace = usePrefs((s) => s.setWorkspace);
  const [email, setEmail] = useState('');
  const del = useMutation({
    mutationFn: () => api.deleteAccount(email.trim()),
    onSuccess: async () => {
      toast.success('Your account has been deleted.');
      setWorkspace(null);
      qc.clear();
      await supabase?.auth.signOut();
    },
  });
  const d = preview.data;
  const matches = !!me.data && email.trim().toLowerCase() === me.data.email.toLowerCase();

  return (
    <Page subtitle="This permanently removes your account. It can’t be undone." testID="delete-account">
      {preview.error ? <ErrorState error={preview.error} onRetry={() => void preview.refetch()} /> : !d || !me.data ? <SkeletonCards count={3} height={80} /> : d.blockers.length ? (
        <Card tone="warning">
          <Row><Icon name="alert-triangle" /><H3 style={{ flex: 1 }}>Sort this out first</H3></Row>
          {d.blockers.map((b) => <Body key={b}>{b}</Body>)}
        </Card>
      ) : (
        <>
          <Card>
            <H3>What will be deleted</H3>
            <Line icon="user" text="Your profile, handle and sign-in" />
            <Line icon="folder" text={`${plural(d.projects, 'project')} in ${d.workspaces.length === 1 ? 'your personal workspace' : `${d.workspaces.length} workspaces only you use`}, and their public pages`} />
            <Line icon="heart" text="Your likes, follows, votes, comments and collections" />
            {d.subscriptionsToCancel ? <Line icon="credit-card" text="Your subscription stops renewing. You won’t be charged again." /> : null}
            <Line icon="users" text="You leave any team you belong to; the team keeps its work" />
          </Card>
          <Card>
            <H3>What we have to keep</H3>
            <Muted>Invoices and payment records, as tax law requires, without your profile attached. Orders placed in your shops stay with those orders. Sites you deployed to an outside host stay there until you remove them.</Muted>
          </Card>
          <Field label={`Type ${me.data.email} to confirm`} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <ErrorText error={del.error} />
          <Button title="Delete my account" variant="danger" icon="trash-2" disabled={!matches} loading={del.isPending} full
            onPress={async () => { if (await confirmAction({ title: 'Delete your account now?', body: 'Everything listed above is removed straight away.', confirm: 'Delete account', destructive: true })) del.mutate(); }} />
          <View style={{ alignItems: 'center' }}><Caption>Questions? Reply to any email from us before deleting.</Caption></View>
        </>
      )}
    </Page>
  );
  function Line({ icon, text }: { icon: React.ComponentProps<typeof Icon>['name']; text: string }) {
    return <Row gap={10} style={{ alignItems: 'flex-start' }}><Icon name={icon} size={15} color={c.textMuted} style={{ marginTop: 3 }} /><Body style={{ flex: 1 }}>{text}</Body></Row>;
  }
}
