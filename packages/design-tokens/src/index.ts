/**
 * Make Your App AI design tokens — single source for web (CSS variables) and mobile (JS objects).
 * Palette: ink neutrals + one confident indigo-violet brand colour, used sparingly. No gradient soup.
 */
export const colors = {
  light: {
    bg: '#FBFBFC',
    surface: '#FFFFFF',
    surfaceMuted: '#F4F4F6',
    border: '#E6E6EB',
    text: '#111114',
    textMuted: '#5E5E6B',
    textSubtle: '#8A8A96',
    brand: '#5B4CF5',
    brandHover: '#4A3BE0',
    brandFg: '#FFFFFF',
    brandSoft: '#EFEDFF',
    success: '#16A34A',
    warning: '#B45309',
    danger: '#DC2626',
    focus: '#5B4CF5',
  },
  dark: {
    bg: '#0B0B0E',
    surface: '#131318',
    surfaceMuted: '#1B1B22',
    border: '#2A2A33',
    text: '#F4F4F6',
    textMuted: '#A3A3B0',
    textSubtle: '#71717E',
    brand: '#8B80FF',
    brandHover: '#A29AFF',
    brandFg: '#0B0B0E',
    brandSoft: '#211E3D',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    focus: '#8B80FF',
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['light'];

export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 999 } as const;

/** Type scale. Mobile body never goes below 15. */
export const fontSize = { xs: 12, sm: 14, base: 15, md: 17, lg: 20, xl: 24, '2xl': 30, '3xl': 38 } as const;
export const fontWeight = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;
export const fontFamily = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

export const motion = { fast: 120, base: 200, slow: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** CSS custom properties for both schemes (light default, dark via [data-theme=dark] or prefers-color-scheme). */
export function toCss(): string {
  const vars = (scheme: ColorScheme) =>
    Object.entries(colors[scheme])
      .map(([k, v]) => `  --color-${kebab(k)}: ${v};`)
      .join('\n');
  const radii = Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`).join('\n');
  return `:root {\n${vars('light')}\n${radii}\n  --font-sans: ${fontFamily.sans};\n  --font-mono: ${fontFamily.mono};\n  color-scheme: light;\n}\n` +
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${vars('dark').replace(/^/gm, '  ')}\n    color-scheme: dark;\n  }\n}\n` +
    `:root[data-theme='dark'] {\n${vars('dark')}\n  color-scheme: dark;\n}\n`;
}
