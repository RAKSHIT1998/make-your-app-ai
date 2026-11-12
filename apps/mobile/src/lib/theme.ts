import { colors, fontSize, radius, space, type ColorScheme } from '@mya/design-tokens';
import { useColorScheme } from 'react-native';
import { create } from 'zustand';

type Pref = 'system' | ColorScheme;
export const useThemePref = create<{ pref: Pref; setPref: (p: Pref) => void }>((set) => ({ pref: 'system', setPref: (pref) => set({ pref }) }));

export function useTheme() {
  const system = useColorScheme();
  const pref = useThemePref((s) => s.pref);
  const scheme: ColorScheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  return { scheme, c: colors[scheme], space, radius, fontSize };
}
export type Theme = ReturnType<typeof useTheme>;
