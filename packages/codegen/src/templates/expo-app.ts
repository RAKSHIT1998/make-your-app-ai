import type { ProjectTemplate } from './types.js';

const j = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * Expo (React Native) app with Expo Router. Builds for iOS and Android run on EAS with the
 * customer's own Apple/Google accounts. Bump `version` on any change.
 */
export const expoAppTemplate: ProjectTemplate = {
  id: 'expo-app',
  version: 1,
  projectTypes: ['mobile_app'],
  description: 'Expo SDK 58 (React Native 0.88), Expo Router file-based navigation, TypeScript. Builds for iOS and Android with EAS.',
  install: ['npm', 'install', '--include=dev', '--no-audit', '--no-fund', '--loglevel=error'],
  checks: [
    { name: 'typecheck', cmd: ['npx', 'tsc', '--noEmit'] },
    { name: 'export', cmd: ['npx', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist-check'] },
  ],
  preview: { cmd: ['npx', 'expo', 'start', '--web', '--port', '{PORT}'], readyPath: '/' },
  agentGuide: [
    'Screens live in app/ (Expo Router): app/index.tsx is the first screen, app/<name>.tsx or app/<folder>/index.tsx for others, app/_layout.tsx defines navigation.',
    'Use React Native primitives (View, Text, Pressable, ScrollView, FlatList, TextInput, Image) and StyleSheet.create. There is no HTML, CSS or Tailwind.',
    'Put shared components in components/ and the colour/spacing theme in lib/theme.ts. Import local modules with the "@/..." alias.',
    'Navigate with expo-router: <Link href="/route"> or useRouter().push("/route").',
    'Only these packages are installed: expo, expo-router, expo-status-bar, expo-constants, expo-linking, react, react-native, react-native-safe-area-context, react-native-screens. Do not import anything else unless you add it to package.json with an Expo SDK 58 compatible version.',
    'Respect safe areas (SafeAreaView from react-native-safe-area-context) and make touch targets at least 44pt.',
    'Never edit app.json identifiers (ios.bundleIdentifier, android.package) — customers set them in App Studio.',
    'Use local data in lib/data.ts for content; mark placeholder content clearly. Never invent facts about the business.',
  ],
  files: {
    'package.json': j({
      name: 'generated-app',
      version: '1.0.0',
      private: true,
      main: 'expo-router/entry',
      scripts: { start: 'expo start', android: 'expo start --android', ios: 'expo start --ios', web: 'expo start --web', typecheck: 'tsc --noEmit' },
      dependencies: {
        expo: '~58.0.24',
        'expo-constants': '~58.0.16',
        'expo-linking': '~58.0.17',
        'expo-router': '~58.0.31',
        'expo-status-bar': '~58.0.5',
        react: '19.3.0',
        'react-dom': '19.3.0',
        'react-native': '0.88.1',
        'react-native-safe-area-context': '~5.11.1',
        'react-native-screens': '~4.30.1',
        'react-native-web': '~0.21.2',
      },
      devDependencies: { '@types/react': '~19.3.0', typescript: '~6.0.3' },
    }),
    'app.json': j({
      expo: {
        name: 'My App',
        slug: 'my-app',
        version: '1.0.0',
        orientation: 'portrait',
        scheme: 'myapp',
        userInterfaceStyle: 'automatic',
        splash: { backgroundColor: '#ffffff', resizeMode: 'contain' },
        ios: { supportsTablet: true, bundleIdentifier: 'com.example.myapp', buildNumber: '1' },
        android: { package: 'com.example.myapp', versionCode: 1, adaptiveIcon: { backgroundColor: '#ffffff' } },
        web: { bundler: 'metro' },
        plugins: ['expo-router'],
        experiments: { typedRoutes: false },
      },
    }),
    'eas.json': j({
      cli: { version: '>= 16.0.0', appVersionSource: 'local' },
      build: {
        development: { developmentClient: true, distribution: 'internal' },
        preview: { distribution: 'internal', android: { buildType: 'apk' } },
        production: {},
      },
      submit: { production: {} },
    }),
    'tsconfig.json': j({ extends: 'expo/tsconfig.base', compilerOptions: { strict: true, paths: { '@/*': ['./*'] } }, include: ['**/*.ts', '**/*.tsx'], exclude: ['node_modules', 'dist-check'] }),
    '.gitignore': 'node_modules/\n.expo/\ndist-check/\n*.jks\n*.p8\n*.p12\n*.key\n*.mobileprovision\n.env*\n',
    'lib/theme.ts': `export const theme = {
  colors: { background: '#ffffff', surface: '#f5f5f4', text: '#111111', muted: '#6b6b6b', primary: '#111111', primaryText: '#ffffff', border: '#e5e5e5' },
  space: (n: number) => n * 4,
  radius: 12,
};
`,
    'app/_layout.tsx': `import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTintColor: theme.colors.text, contentStyle: { backgroundColor: theme.colors.background } }} />
    </SafeAreaProvider>
  );
}
`,
    'app/index.tsx': `import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/lib/theme';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your app</Text>
      <Text style={styles.body}>Describe what you want to build and the AI will create your screens.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: theme.space(6), justifyContent: 'center', gap: theme.space(2) },
  title: { fontSize: 28, fontWeight: '700', color: theme.colors.text },
  body: { fontSize: 16, color: theme.colors.muted },
});
`,
  },
};
