# Third-party notices

## anthropics/skills (Apache License 2.0)

Source: https://github.com/anthropics/skills (commit 2c5958ecac7cee2b583967a2c4981d0f4a75c579). Copyright Anthropic, PBC. Licensed under the
Apache License, Version 2.0; full text in `licenses/anthropic-skills-LICENSE.txt`.

Adapted material:

| From | Used in | Changes made |
|---|---|---|
| `skills/frontend-design/SKILL.md` | `packages/agents/src/design-guide.ts` (designer and frontend agent instructions) | Condensed and rewritten as agent rules; typography adapted to system font stacks (generated apps run sandboxed without web-font downloads); combined with this platform's own accessibility and honesty rules |
| `skills/theme-factory/themes/*.md` | `packages/shared/src/color-themes.ts` (Colour theme picker on Create) | Kept theme names, palettes and suggested uses; dropped document fonts; colours may be adjusted by the designer agent to meet WCAG AA contrast |

No code or scripts from the repository are included or executed.

## open-hotel-pms (MIT License)

Source: https://github.com/peeraseepat-cell/open-hotel-pms (commit 3f6956a54aa9faef44311f9e943ce7d44b6934e3). Copyright (c) 2026 Peerasee.
Licensed under the MIT License; full text in `licenses/open-hotel-pms-LICENSE.txt`.

Used: its data model and operational workflow (rooms with sellable and housekeeping state, per-night room occupancy to prevent
double-booking, reservations with source and OTA reference, guest folio of charges and payments, housekeeping log, shift
logbook, night audit for no-shows) informed the "Hotel front desk (PMS)" business kit in
`packages/shared/src/business-kits.ts`. The kit brief is our own wording; no code, SQL or text is included.

## Reviewed and not used

- **frappe/crm** (AGPL-3.0, commit 73ec05a1712909ea2ad0e631e088baa5fa3ea4a5): its public feature list (separate leads and deals, stage
  probability, tasks, call logs, notes, lost reasons) was compared with our CRM kit; no code, schema or text was copied,
  because AGPL-3.0 code would impose its terms on the platform and on generated apps.
- **ahmedali5530/restaurant-pos** (POSR Source Available License 1.0): its licence forbids offering it or derivatives as a
  hosted service and using its code or architecture for a competing product, so nothing from it was read beyond the licence
  or used. Our Restaurant kit is based on common restaurant practice.
