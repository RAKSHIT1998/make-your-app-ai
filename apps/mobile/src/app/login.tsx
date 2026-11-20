import * as Linking from 'expo-linking';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/bits';
import { Body, Button, Caption, Card, ErrorText, Field, H1, H2, Muted, Screen, Segmented } from '@/components/ui';
import { WEB_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function Login() {
  const { configured } = useAuth();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === 'reset') {
      // The link opens the website, where the new password is chosen.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), WEB_URL ? { redirectTo: `${WEB_URL}/reset-password` } : undefined);
      setBusy(false);
      if (error) setError(error);
      else setNotice('If that email has an account, a link to choose a new password is on its way.');
      return;
    }
    const { data, error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error);
    else if (mode === 'signup' && !data.session) setNotice('Check your inbox to confirm your email, then sign in.');
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: insets.top + 24, gap: 28 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 14 }}>
            <BrandMark size={52} />
            <H1 style={{ fontSize: 34, lineHeight: 40 }}>Build anything.{'\n'}From anywhere.</H1>
            <Muted>Describe an idea and get a working website, app, game or shop you own.</Muted>
          </View>
          <Card style={{ gap: 16, padding: 20 }}>
            {!configured ? (
              <Body muted>This build isn't connected to a server yet. Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and EXPO_PUBLIC_API_URL, then rebuild.</Body>
            ) : (
              <>
                {mode === 'reset' ? <H2>Reset your password</H2> : (
                  <Segmented label="Sign in or create an account" value={mode} onChange={(m) => { setMode(m); setError(null); setNotice(null); }} options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }]} />
                )}
                <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
                {mode !== 'reset' ? <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signin' ? 'password' : 'new-password'} textContentType={mode === 'signin' ? 'password' : 'newPassword'}
                  hint={mode === 'signup' ? 'At least 8 characters.' : undefined} onSubmitEditing={() => validEmail && password.length >= 8 && void submit()} returnKeyType="go" /> : null}
                <ErrorText error={error} />
                {notice ? <Text accessibilityRole="alert" style={{ color: c.success, fontSize: 14 }}>{notice}</Text> : null}
                <Button title={mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'} onPress={submit} loading={busy} disabled={!validEmail || (mode !== 'reset' && password.length < 8)} full />
                <Button title={mode === 'reset' ? 'Back to sign in' : 'Forgot your password?'} variant="ghost" size="sm" onPress={() => { setMode(mode === 'reset' ? 'signin' : 'reset'); setError(null); setNotice(null); }} />
              </>
            )}
          </Card>
          {WEB_URL ? (
            <Caption style={{ textAlign: 'center' }}>
              By continuing you agree to the{' '}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(`${WEB_URL}/legal/terms`)} style={{ color: c.text, textDecorationLine: 'underline' }}>Terms</Text>
              {' '}and{' '}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(`${WEB_URL}/legal/privacy`)} style={{ color: c.text, textDecorationLine: 'underline' }}>Privacy Policy</Text>.
            </Caption>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
