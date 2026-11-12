import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function Login() {
  const { configured } = useAuth();
  const { c } = useTheme();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { data, error } = mode === 'signin' ? await supabase.auth.signInWithPassword({ email: email.trim(), password }) : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error);
    else if (mode === 'signup' && !data.session) setNotice('Check your inbox to confirm your email, then sign in.');
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 24 }} keyboardShouldPersistTaps="handled">
            <View style={{ alignItems: 'center', gap: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: c.brandFg, fontSize: 26, fontWeight: '800' }}>M</Text>
              </View>
              <Title>Make Your App AI</Title>
              <Body muted>Build Anything. From Anywhere.</Body>
            </View>
            <Card style={{ gap: 16 }}>
              {!configured ? (
                <Body muted>Sign-in isn&apos;t configured yet. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY and restart.</Body>
              ) : (
                <>
                  <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</Text>
                  <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
                  <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signin' ? 'password' : 'new-password'} />
                  <ErrorText error={error} />
                  {notice && <Body style={{ color: c.brand }}>{notice}</Body>}
                  <Button title={mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} disabled={!email || password.length < 8} />
                  <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')} accessibilityRole="button">
                    <Text style={{ color: c.brand, textAlign: 'center', fontWeight: '600' }}>{mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}</Text>
                  </Pressable>
                </>
              )}
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
