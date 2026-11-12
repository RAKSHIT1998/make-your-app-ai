import { PROJECT_TYPE_LABELS, type ProjectType } from '@mya/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Body, Button, ErrorText, Field, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

const TYPES: { type: ProjectType; available: boolean }[] = [
  { type: 'website', available: true },
  { type: 'business_website', available: true },
  { type: 'mobile_app', available: false },
  { type: 'ecommerce', available: false },
  { type: 'saas', available: false },
  { type: 'custom_software', available: false },
];

export default function Create() {
  const { c, radius } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [type, setType] = useState<ProjectType | null>(null);
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const p = await api.createProject({ name: name.trim() || 'Untitled project', type: type!, description: idea.trim() });
      await api.generate(p.id, idea.trim());
      return p;
    },
    onSuccess: (p) => {
      setName('');
      setIdea('');
      setType(null);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      router.push({ pathname: '/project/[id]', params: { id: p.id } });
    },
  });

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: c.textMuted, fontWeight: '700', fontSize: 13, letterSpacing: 0.6 }}>WHAT ARE YOU BUILDING?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup">
            {TYPES.map(({ type: t, available }) => {
              const on = type === t;
              return (
                <Pressable key={t} disabled={!available} onPress={() => setType(t)} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !available }}
                  style={{ width: '48%', minHeight: 64, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brandSoft : c.surface, opacity: available ? 1 : 0.55, justifyContent: 'center' }}>
                  <Text style={{ color: on ? c.brand : c.text, fontWeight: '600', fontSize: 15 }}>{PROJECT_TYPE_LABELS[t]}</Text>
                  {!available && <Text style={{ color: c.textSubtle, fontSize: 12, marginTop: 2 }}>Coming soon</Text>}
                </Pressable>
              );
            })}
          </View>
          <Field label="Project name" value={name} onChangeText={setName} placeholder="e.g. Grand Lake Hotel" maxLength={80} />
          <Field label="Your idea" value={idea} onChangeText={setIdea} multiline maxLength={8000} placeholder="Who is it for, which pages you need, and the look you want." />
          <Body muted style={{ fontSize: 13 }}>We use placeholder text where facts are unknown — never invented reviews or statistics.</Body>
          <ErrorText error={create.error} />
          <Button title="Generate project" onPress={() => create.mutate()} loading={create.isPending} disabled={!type || idea.trim().length < 10} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
