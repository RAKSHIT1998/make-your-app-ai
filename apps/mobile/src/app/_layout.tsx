import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfirmHost, ToastHost } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

/** Screens that work signed out. */
const PUBLIC = new Set(['login', 'p', 'challenges', 'leaderboard', 'legal']);

function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { c, scheme } = useTheme();
  useEffect(() => {
    if (loading) return;
    const first = segments[0] ?? '';
    if (!session && !PUBLIC.has(first)) router.replace('/login');
    else if (session && first === 'login') router.replace('/');
  }, [session, loading, segments, router]);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600', fontSize: 17 }, contentStyle: { backgroundColor: c.bg }, headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="project/[id]" options={{ title: '' }} />
        <Stack.Screen name="p/[slug]" options={{ title: '' }} />
        <Stack.Screen name="challenges/index" options={{ title: 'Challenges' }} />
        <Stack.Screen name="challenges/[slug]" options={{ title: '' }} />
        <Stack.Screen name="leaderboard" options={{ title: 'Top creators' }} />
        <Stack.Screen name="achievements" options={{ title: 'Badges and streak' }} />
        <Stack.Screen name="plan" options={{ title: 'Plan and usage' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
        <Stack.Screen name="owner/index" options={{ title: 'Owner' }} />
        <Stack.Screen name="owner/flags" options={{ title: 'Kill switches' }} />
      </Stack>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500) } },
        // A token the server no longer accepts (account deleted or suspended elsewhere) signs the app out instead of looping.
        queryCache: new QueryCache({ onError: (e) => { if (e instanceof ApiError && (e.status === 401 || (e.status === 403 && e.message === 'Account is not active'))) void supabase?.auth.signOut(); } }),
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
