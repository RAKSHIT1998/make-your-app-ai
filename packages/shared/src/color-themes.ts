/**
 * Colour themes customers can pick on Create. Palettes from the "theme-factory" skill in
 * https://github.com/anthropics/skills (Apache License 2.0, Copyright Anthropic, PBC). Changes: kept the names, palettes
 * and suggested uses; dropped the document fonts (generated apps use system font stacks); the designer agent may
 * adjust lightness to meet WCAG AA contrast. See THIRD_PARTY_NOTICES.md.
 */
export interface ColorTheme { id: string; name: string; mood: string; colors: { name: string; hex: string }[]; bestFor: string }

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'ocean-depths', name: 'Ocean Depths', mood: 'Professional and calming', colors: [{ name: 'Deep navy', hex: '#1a2332' }, { name: 'Teal', hex: '#2d8b8b' }, { name: 'Seafoam', hex: '#a8dadc' }, { name: 'Cream', hex: '#f1faee' }], bestFor: 'Finance, consulting, maritime, corporate' },
  { id: 'sunset-boulevard', name: 'Sunset Boulevard', mood: 'Warm and energetic', colors: [{ name: 'Burnt orange', hex: '#e76f51' }, { name: 'Coral', hex: '#f4a261' }, { name: 'Warm sand', hex: '#e9c46a' }, { name: 'Deep teal', hex: '#264653' }], bestFor: 'Creative studios, events, food, travel' },
  { id: 'forest-canopy', name: 'Forest Canopy', mood: 'Natural and grounded', colors: [{ name: 'Forest green', hex: '#2d4a2b' }, { name: 'Sage', hex: '#7d8471' }, { name: 'Olive', hex: '#a4ac86' }, { name: 'Ivory', hex: '#faf9f6' }], bestFor: 'Outdoors, sustainability, wellness, farms' },
  { id: 'modern-minimalist', name: 'Modern Minimalist', mood: 'Clean and contemporary', colors: [{ name: 'Charcoal', hex: '#36454f' }, { name: 'Slate grey', hex: '#708090' }, { name: 'Light grey', hex: '#d3d3d3' }, { name: 'White', hex: '#ffffff' }], bestFor: 'Tech, architecture, portfolios, business tools' },
  { id: 'golden-hour', name: 'Golden Hour', mood: 'Rich and warm', colors: [{ name: 'Mustard', hex: '#f4a900' }, { name: 'Terracotta', hex: '#c1666b' }, { name: 'Warm beige', hex: '#d4b896' }, { name: 'Chocolate', hex: '#4a403a' }], bestFor: 'Restaurants, hospitality, crafts, autumn events' },
  { id: 'arctic-frost', name: 'Arctic Frost', mood: 'Cool and precise', colors: [{ name: 'Ice blue', hex: '#d4e4f7' }, { name: 'Steel blue', hex: '#4a6fa5' }, { name: 'Silver', hex: '#c0c0c0' }, { name: 'Crisp white', hex: '#fafafa' }], bestFor: 'Healthcare, clean tech, pharmaceuticals, winter sports' },
  { id: 'desert-rose', name: 'Desert Rose', mood: 'Soft and sophisticated', colors: [{ name: 'Dusty rose', hex: '#d4a5a5' }, { name: 'Clay', hex: '#b87d6d' }, { name: 'Sand', hex: '#e8d5c4' }, { name: 'Deep burgundy', hex: '#5d2e46' }], bestFor: 'Fashion, beauty, weddings, interiors' },
  { id: 'tech-innovation', name: 'Tech Innovation', mood: 'Bold and high-contrast', colors: [{ name: 'Electric blue', hex: '#0066ff' }, { name: 'Neon cyan', hex: '#00ffff' }, { name: 'Dark grey', hex: '#1e1e1e' }, { name: 'White', hex: '#ffffff' }], bestFor: 'Software, startups, AI, gaming' },
  { id: 'botanical-garden', name: 'Botanical Garden', mood: 'Fresh and organic', colors: [{ name: 'Fern green', hex: '#4a7c59' }, { name: 'Marigold', hex: '#f9a620' }, { name: 'Terracotta', hex: '#b7472a' }, { name: 'Cream', hex: '#f5f3ed' }], bestFor: 'Gardens, organic food, florists, nature' },
  { id: 'midnight-galaxy', name: 'Midnight Galaxy', mood: 'Dramatic and cosmic', colors: [{ name: 'Deep purple', hex: '#2b1e3e' }, { name: 'Cosmic blue', hex: '#4a4e8f' }, { name: 'Lavender', hex: '#a490c2' }, { name: 'Silver', hex: '#e6e6fa' }], bestFor: 'Entertainment, music, nightlife, games' },
];

/** The sentence added to the customer's brief when they pick a theme. */
export const themeBrief = (t: ColorTheme) => `Colour theme: ${t.name} (${t.mood.toLowerCase()}) — ${t.colors.map((c) => `${c.name.toLowerCase()} ${c.hex}`).join(', ')}`;
