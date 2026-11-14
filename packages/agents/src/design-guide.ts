/**
 * Design craft guidance for the designer and frontend agents.
 *
 * Adapted from the "frontend-design" skill in https://github.com/anthropics/skills (Apache License 2.0,
 * Copyright Anthropic, PBC). Changes: condensed; rewritten as rules for agents that return JSON; typography adapted to
 * this platform's sandbox (system font stacks only, no web-font downloads); combined with this platform's own rules
 * (accessibility floor, no invented facts). See THIRD_PARTY_NOTICES.md and licenses/anthropic-skills-LICENSE.txt.
 */

/** For the designer agent, which chooses the palette, type and tone. */
export const DESIGN_DIRECTION = `Design direction:
- Ground every choice in the subject: its industry, materials, vernacular and audience. A toy shop and a financial dashboard must look nothing alike. Make deliberate choices specific to this brief, never a default you would produce for any similar project.
- These are the common tells of generated design; do not use them unless the brief asks for them: a warm cream background with a high-contrast serif and a terracotta/clay accent; a near-black background with one acid-green or vermilion accent; content chopped into identical rounded cards with the same soft grey shadow and gradient washes; an ALL-CAPS tracked label above every heading; meta text joined with middle dots; "→" appended to buttons.
- If the customer named a colour theme or brand colour, build the palette from it, adjusting lightness only as far as needed for contrast.
- Typography carries the personality: choose one or two system font stacks deliberately (a serif stack, a humanist sans, a geometric sans, a rounded or a monospace stack — whichever fits the subject), with a clear scale. If two, make them clearly distinct.
- Spend boldness in one place: one memorable element; everything around it quiet and disciplined.
- Accessibility is the floor, never traded away: WCAG AA contrast for text on background and for primaryForeground on primary.`;

/** For the frontend agent, which writes the code. */
export const CRAFT_RULES = [
  'Design craft: follow the design spec exactly; let the hero open with the most characteristic thing in the subject\'s world (a headline, a live element, a real product view) rather than the default big-number-plus-stats block.',
  'Avoid generated-page tells: one word in a headline set in a different colour or italic, ALL-CAPS labels, decorative labels above content, numbered markers (01/02/03) on content that is not a real sequence, identical cards with one radius and one shadow everywhere, fade-and-slide-up on every section, hover effects on every card. Use structure (borders, numbering, dividers) only when it encodes real information.',
  'Motion: at most one orchestrated moment (one page-load sequence or one reveal); motion that answers a person\'s action is fine. Respect prefers-reduced-motion.',
  'Line length under 80 characters for body text. Responsive down to 320px, visible keyboard focus, no layout shift.',
  'Words are design: write from the user\'s side in plain language, sentence case, active voice. A button says exactly what happens ("Save changes", not "Submit") and keeps that name through the flow ("Publish" → "Published"). Errors say what went wrong and how to fix it, without apologising. Empty states invite the next action.',
  'CSS: keep selector specificity flat (classes, not chains of element selectors) so spacing rules do not cancel each other out.',
];
