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
