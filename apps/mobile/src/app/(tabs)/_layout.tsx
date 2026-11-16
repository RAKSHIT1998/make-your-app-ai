import Feather from '@expo/vector-icons/Feather';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/prefs';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { c } = useTheme();
  const { session, loading } = useAuth();
  const qc = useQueryClient();
  const workspace = usePrefs((s) => s.workspaceId);
  // Switching workspace changes what every list means: refetch everything.
  const firstWorkspace = useRef(workspace);
  useEffect(() => {
    if (firstWorkspace.current === workspace) return;
    firstWorkspace.current = workspace;
    void qc.invalidateQueries();
  }, [workspace, qc]);
  if (loading) return null;
  if (!session) return <Redirect href="/login" />;
  const icon = (name: React.ComponentProps<typeof Feather>['name']) => ({ color }: { color: import('react-native').ColorValue }) => <Feather name={name} color={color as string} size={22} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.textSubtle,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, ...(Platform.OS === 'web' ? { height: 64, paddingBottom: 8 } : {}) },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects', tabBarIcon: icon('folder') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarAccessibilityLabel: 'Create a project',
          tabBarIcon: () => (
            <View style={{ width: 44, height: 32, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="plus" size={20} color={c.primaryFg} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="explore" options={{ title: 'Explore', tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
