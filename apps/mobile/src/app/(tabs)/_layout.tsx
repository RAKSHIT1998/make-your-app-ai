import Feather from '@expo/vector-icons/Feather';
import { Redirect, Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { c } = useTheme();
  const { session, loading } = useAuth();
  // Don't mount tab screens (and fire authenticated queries) until a session exists.
  if (loading) return null;
  if (!session) return <Redirect href="/login" />;
  const icon = (name: React.ComponentProps<typeof Feather>['name']) => ({ color, size }: { color: import('react-native').ColorValue; size: number }) => <Feather name={name} color={typeof color === 'string' ? color : undefined} size={size - 2} />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.brand, tabBarInactiveTintColor: c.textSubtle, tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, ...(Platform.OS === 'web' ? { height: 64, paddingBottom: 8 } : {}) }, headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, headerShadowVisible: false, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="create" options={{ title: 'Create', tabBarIcon: icon('plus-circle') }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: icon('folder') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
