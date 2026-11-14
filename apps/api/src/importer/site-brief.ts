/**
 * Turns pages read from a customer's current website into a build brief, without AI: their own words, trimmed.
 * The brief goes into the Create box, where the customer reads and edits it before anything is built or charged.
 */
export interface CrawledPage { url: string; title: string; description: string; markdown: string; images?: { src: string; alt: string }[] }

export const BRIEF_MAX_CHARS = 6000;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)\d{3,5}[\s-]?\d{3,5}/g;

/** Markdown to plain sentences: images dropped, links kept as their text, headings and emphasis marks removed. */
export function plainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathOf(url: string) {
  try { const u = new URL(url); return u.pathname === '' ? '/' : u.pathname; } catch { return url; }
}

function clip(s: string, n: number) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, end > n * 0.6 ? end + 1 : n).trim()}…`;
}

export function contactDetails(pages: CrawledPage[]) {
  const text = pages.map((p) => plainText(p.markdown)).join(' ');
  const emails = [...new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase()))].slice(0, 3);
  const phones = [...new Set((text.match(PHONE) ?? []).map((p) => p.trim()).filter((p) => p.replace(/\D/g, '').length >= 8))].slice(0, 3);
  return { emails, phones };
}

export function buildSiteBrief(siteUrl: string, pages: CrawledPage[]): string {
  const home = pages[0];
  const head = [
    'Rebuild my current website as a modern, fast, mobile-friendly site. Keep my real content and facts below and improve the layout, design and wording. Do not invent prices, reviews, awards or claims that are not below; use clearly marked placeholders where something is missing.',
    '',
    `Current site: ${siteUrl}`,
    home?.title ? `Name: ${home.title}` : '',
    home?.description ? `About: ${home.description}` : '',
  ];
  const { emails, phones } = contactDetails(pages);
  if (emails.length || phones.length) head.push(`Contact: ${[...phones, ...emails].join(' · ')}`);
  head.push('', `Pages to keep (${pages.length}):`);
  const top = head.filter((l, i) => l !== '' || head[i - 1] !== '').join('\n');
  const budget = Math.max(200, Math.floor((BRIEF_MAX_CHARS - top.length - 20) / Math.max(1, pages.length)));
  const lines = pages.map((p) => {
    const label = `- ${pathOf(p.url)}${p.title ? ` (${p.title})` : ''}: `;
    return label + clip(plainText(p.markdown), Math.max(80, budget - label.length));
  });
  return clip(`${top}\n${lines.join('\n')}`, BRIEF_MAX_CHARS);
}
