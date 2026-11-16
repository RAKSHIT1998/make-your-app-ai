import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ColorScheme } from '@mya/design-tokens';

export type ThemePref = 'system' | ColorScheme;

interface Prefs {
  theme: ThemePref;
  /** Workspace the app is working in. The server re-checks membership on every request. */
  workspaceId: string | null;
  /** Creators this person chose not to see in Explore and challenges (kept on this device). */
  hiddenCreators: string[];
  setTheme: (t: ThemePref) => void;
  setWorkspace: (id: string | null) => void;
  hideCreator: (handle: string) => void;
  unhideCreator: (handle: string) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: 'system',
      workspaceId: null,
      hiddenCreators: [],
      setTheme: (theme) => set({ theme }),
      setWorkspace: (workspaceId) => set({ workspaceId }),
      hideCreator: (h) => set((s) => ({ hiddenCreators: s.hiddenCreators.includes(h) ? s.hiddenCreators : [...s.hiddenCreators, h] })),
      unhideCreator: (h) => set((s) => ({ hiddenCreators: s.hiddenCreators.filter((x) => x !== h) })),
    }),
    { name: 'mya-prefs', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);

/** Read outside React (the API client). */
export const activeWorkspace = () => usePrefs.getState().workspaceId;
