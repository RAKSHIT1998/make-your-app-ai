# Design System (v2)

Source of truth: `packages/design-tokens/src/index.ts` → `dist/tokens.css` (CSS variables), mapped to Tailwind in `apps/web/app/globals.css`. Components live in `apps/web/components/ui/`.

## Identity
Premium, quiet, trustworthy. Warm neutrals, ink as the primary action colour, one ember accent used sparingly (live state, focus, the brand dot). No gradients, no glass, no decorative charts.

## Tokens
| Group | Values |
|---|---|
| Colour (semantic) | `bg, surface, surface-muted, surface-sunken, border, border-strong, fg, muted, subtle, primary(-hover,-fg), accent(-hover,-fg,-soft,-text), success/warning/danger/info(-soft), focus, overlay` — light and dark sets, AA contrast for text (`accent-text` exists for accent-coloured text) |
| Type | Geist Sans / Geist Mono. Scale: 11 (eyebrow), 12, 13 (secondary), 14 (body), 16 (mobile inputs, avoids iOS zoom), 18, 20, 24, 30, 48. Headings use negative tracking |
| Spacing | Tailwind 4px scale; page gutters 16 / 24 / 32 |
| Radius | sm 6 · md 8 · lg 12 · xl 16 · full |
| Shadow | sm · md · lg · overlay |
| Motion | fade-in, pop-in, slide-in-right, slide-in-bottom; 150–200 ms; disabled under `prefers-reduced-motion` |

## Components
`Button` (primary, accent, secondary, ghost, danger · xs–lg · loading · icon-only) · `Input`, `Textarea`, `Select`, `Field` · `Card` · `PageHeader`, `SectionTitle` · `Badge`, `StatusBadge` (human labels) · `Kbd` · `Skeleton`, `Spinner` · `EmptyState`, `ErrorNotice` (retry), `Notice` · `Meter`, `Stat` · `SoonBadge` (the only way to show unbuilt features) · `Dialog` (bottom sheet on mobile) · `Drawer` · `useConfirm` (promise-based, optional input) · `Menu` · `Tabs`, `Segmented` · `Tooltip` · `toast` (sonner) · `DataTable` (table ≥ lg, stacked list below). `cx` = clsx + tailwind-merge so callers can override defaults.

## Navigation
Desktop: collapsible sidebar (⌘B, remembered), auto icon-rail on tablets and in the workspace, ⌘K palette. Mobile: top bar with credits and search; bottom bar Home · Projects · Create (centre) · Studios · More, safe-area aware. Hosting and Templates appear with "soon" and are not links.

## Rules
- Only real backend data. Anything not built is labelled "soon" and disabled.
- Destructive actions use `useConfirm`; outcomes use toasts.
- Every page is checked for horizontal overflow at 360–1440 px.
