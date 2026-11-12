import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Body, Button, Card, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTheme, useThemePref } from '@/lib/theme';

export default function Settings() {
  const { c, radius } = useTheme();
  const { pref, setPref } = useThemePref();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Card style={{ gap: 4 }}>
          <Body muted>Signed in as</Body>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{me.data?.email ?? '…'}</Text>
        </Card>
        <Card style={{ gap: 10 }}>
          <Body muted>Appearance</Body>
          <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
            {(['system', 'light', 'dark'] as const).map((p) => (
              <Pressable key={p} onPress={() => setPref(p)} accessibilityRole="radio" accessibilityState={{ checked: pref === p }} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: pref === p ? c.brandSoft : c.surfaceMuted }}>
                <Text style={{ color: pref === p ? c.brand : c.textMuted, fontWeight: '600', textTransform: 'capitalize' }}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
        <Button title="Sign out" variant="secondary" onPress={() => void supabase?.auth.signOut()} />
      </ScrollView>
    </Screen>
  );
}
