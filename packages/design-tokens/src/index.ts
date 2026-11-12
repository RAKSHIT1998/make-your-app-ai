/**
 * Make Your App AI design tokens v2 — single source for web (CSS variables) and mobile (JS objects).
 * Identity: warm neutrals, ink-black primary actions, and one restrained "ember" accent used for focus,
 * active states and the brand mark. Accent is never used for body text except via `accentText` (AA contrast).
 * `brand*` keys are kept as aliases of the primary for backwards compatibility.
 */
const light = {
  bg: '#FAFAF9',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F4F2',
  surfaceSunken: '#EFEFEC',
  border: '#E7E5E1',
  borderStrong: '#D6D3CE',
  text: '#0C0C0B',
  textMuted: '#5F5E5A',
  textSubtle: '#86847E',
  primary: '#0C0C0B',
  primaryHover: '#2A2A27',
  primaryFg: '#FFFFFF',
  accent: '#F2541B',
  accentHover: '#D9440F',
  accentFg: '#FFFFFF',
  accentSoft: '#FDEEE7',
  accentText: '#B83A0B',
  success: '#15803D',
  successSoft: '#E9F6EE',
  warning: '#A85F06',
  warningSoft: '#FCF3E2',
  danger: '#C2271B',
  dangerSoft: '#FCECEA',
  info: '#1D4ED8',
  infoSoft: '#EAF0FD',
  focus: '#F2541B',
  overlay: 'rgba(12, 12, 11, 0.42)',
};
const dark: typeof light = {
  bg: '#0A0A09',
  surface: '#131312',
  surfaceMuted: '#1B1B19',
  surfaceSunken: '#0F0F0E',
  border: '#262624',
  borderStrong: '#363531',
  text: '#F3F2EF',
  textMuted: '#A6A49E',
  textSubtle: '#7A7872',
  primary: '#F3F2EF',
  primaryHover: '#DCDAD5',
  primaryFg: '#0A0A09',
  accent: '#FF6A33',
  accentHover: '#FF845A',
  accentFg: '#0A0A09',
  accentSoft: '#2B170F',
  accentText: '#FF9466',
  success: '#4ADE80',
  successSoft: '#10251A',
  warning: '#F5B544',
  warningSoft: '#2A2110',
  danger: '#F87171',
  dangerSoft: '#2C1414',
  info: '#7AA7FF',
  infoSoft: '#111C33',
  focus: '#FF6A33',
  overlay: 'rgba(0, 0, 0, 0.6)',
};
const withAliases = (c: typeof light) => ({ ...c, brand: c.primary, brandHover: c.primaryHover, brandFg: c.primaryFg, brandSoft: c.surfaceMuted });

export const colors = { light: withAliases(light), dark: withAliases(dark) } as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['light'];

export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const radius = { sm: 6, md: 8, lg: 12, xl: 16, full: 999 } as const;

export const shadow = {
  sm: '0 1px 2px rgba(12,12,11,0.05)',
  md: '0 1px 2px rgba(12,12,11,0.04), 0 4px 12px rgba(12,12,11,0.06)',
  lg: '0 2px 4px rgba(12,12,11,0.04), 0 12px 32px rgba(12,12,11,0.10)',
  overlay: '0 8px 16px rgba(12,12,11,0.08), 0 24px 64px rgba(12,12,11,0.18)',
} as const;

/** Type scale. Mobile body never goes below 15. */
export const fontSize = { xs: 12, sm: 14, base: 15, md: 17, lg: 20, xl: 24, '2xl': 30, '3xl': 38 } as const;
export const fontWeight = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;
export const fontFamily = {
  sans: 'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

export const motion = { fast: 120, base: 200, slow: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** CSS custom properties for both schemes (light default, dark via [data-theme=dark] or prefers-color-scheme). */
export function toCss(): string {
  const vars = (scheme: ColorScheme) =>
    Object.entries(colors[scheme])
      .map(([k, v]) => `  --color-${kebab(k)}: ${v};`)
      .join('\n');
  const radii = Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`).join('\n') + '\n' + Object.entries(shadow).map(([k, v]) => `  --shadow-${k}: ${v};`).join('\n');
  return `:root {\n${vars('light')}\n${radii}\n  --font-sans: ${fontFamily.sans};\n  --font-mono: ${fontFamily.mono};\n  color-scheme: light;\n}\n` +
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${vars('dark').replace(/^/gm, '  ')}\n    color-scheme: dark;\n  }\n}\n` +
    `:root[data-theme='dark'] {\n${vars('dark')}\n  color-scheme: dark;\n}\n`;
}
