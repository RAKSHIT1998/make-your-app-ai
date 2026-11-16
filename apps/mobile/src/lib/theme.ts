import { colors, fontSize, radius, space, type ColorScheme } from '@mya/design-tokens';
import { useColorScheme } from 'react-native';
import { usePrefs } from './prefs';

export function useTheme() {
  const system = useColorScheme();
  const pref = usePrefs((s) => s.theme);
  const scheme: ColorScheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  return { scheme, c: colors[scheme], space, radius, fontSize };
}
export type Theme = ReturnType<typeof useTheme>;
