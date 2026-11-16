import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Caption, ErrorState, ErrorText, Field, Page, SkeletonCards, toast } from '@/components/ui';
import { api } from '@/lib/api';

export default function Profile() {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  useEffect(() => {
    if (!me.data) return;
    setName(me.data.displayName ?? ''); setHandle(me.data.handle ?? ''); setBio(me.data.bio ?? '');
  }, [me.data]);
  const save = useMutation({
    mutationFn: () => api.updateMe({ displayName: name.trim() || null, bio: bio.trim(), ...(handle.trim() ? { handle: handle.trim().toLowerCase() } : {}) }),
    onSuccess: (d) => { qc.setQueryData(['me'], d); toast.success('Profile saved'); router.back(); },
  });
  const handleOk = !handle || /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/i.test(handle.trim());
  return (
    <Page subtitle="Shown on your public projects and in challenges.">
      {me.error ? <ErrorState error={me.error} onRetry={() => void me.refetch()} /> : !me.data ? <SkeletonCards count={3} height={60} /> : (
        <>
          <Field label="Display name" value={name} onChangeText={setName} maxLength={80} placeholder="How others see you" />
          <Field label="Handle" value={handle} onChangeText={(t) => setHandle(t.replace(/\s/g, ''))} autoCapitalize="none" autoCorrect={false} maxLength={30}
            hint="Letters, numbers and dashes. Your creator page address." error={handleOk ? null : 'Use 3–30 letters, numbers or dashes.'} />
          <Field label="Bio" value={bio} onChangeText={setBio} maxLength={280} multiline style={{ minHeight: 90 }} />
          <Caption>Signed in as {me.data.email}</Caption>
          <ErrorText error={save.error} />
          <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!handleOk} full />
        </>
      )}
    </Page>
  );
}
