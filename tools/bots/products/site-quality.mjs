import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const meta = {
  name: 'site-quality',
  product: 'Accessibility, links and page basics',
  covers: 'axe accessibility checks (WCAG 2 A/AA) on every public and signed-in page, page titles and language, meta descriptions and social cards on public pages, one main heading, every internal link answering, and no sideways scrolling',
};

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PUBLIC = ['/', '/pricing', '/explore', '/challenges', '/leaderboard', '/credits', '/legal/terms', '/legal/privacy', '/legal/refunds', '/login'];
const SIGNED_IN = ['/home', '/create', '/projects', '/billing', '/settings', '/team', '/ideas', '/templates', '/hosting', '/stores', '/studio/apps', '/collections'];

/** Runs axe on the page; returns serious/critical problems as readable lines (minor ones are reported, not failed). */
async function axe(page) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
  return result;
}

export async function run(bot) {
  const page = await bot.page();
  const problems = [];
  const minor = [];
  const links = new Set();

  const audit = async (path, { isPublic }) => {
    await page.goto(`${bot.web}${path}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    const facts = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
      h1: document.querySelectorAll('h1').length,
      hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
    }));
    if (!facts.title.trim()) problems.push(`${path}: no page title`);
    if (!facts.lang) problems.push(`${path}: <html> has no lang`);
    if (facts.h1 !== 1) problems.push(`${path}: ${facts.h1} main headings (h1), expected 1`);
    if (isPublic && path !== '/login' && facts.description.length < 40) problems.push(`${path}: missing or too short meta description`);
    if (isPublic && path !== '/login' && !facts.ogImage) problems.push(`${path}: no social card image (og:image)`);
    for (const h of facts.hrefs) if (h && h.startsWith('/') && !h.startsWith('//')) links.add(h.split('#')[0]);
    for (const v of await axe(page)) {
      const line = `${path}: [${v.impact}] ${v.help} (${v.id}) at ${v.nodes.join(' | ')}`;
      if (v.impact === 'serious' || v.impact === 'critical') problems.push(line);
      else minor.push(line);
    }
    await bot.noSidewaysScroll(page, path);
  };

  await bot.step('Checks every public page', async () => {
    for (const p of PUBLIC) await audit(p, { isPublic: true });
  });

  await bot.step('Checks every signed-in page', async () => {
    await bot.signIn(page);
    for (const p of SIGNED_IN) await audit(p, { isPublic: false });
    await bot.shot(page, 'last-page');
  });

  await bot.step('Every internal link answers', async () => {
    const broken = [];
    for (const href of links) {
      if (/^\/(api|_next)\//.test(href)) continue;
      const r = await fetch(`${bot.web}${href}`, { redirect: 'manual' });
      if (r.status >= 400) broken.push(`${href} → ${r.status}`);
    }
    if (broken.length) problems.push(...broken.map((b) => `broken link ${b}`));
    bot.note?.(`${links.size} internal links checked`);
  });

  await bot.step('Has no serious accessibility or page problems', async () => {
    // Full list next to the report (the report itself shortens long errors).
    mkdirSync(new URL('../report/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`../report/site-quality-${bot.device}.txt`, import.meta.url), `PROBLEMS (${problems.length})\n${problems.join('\n')}\n\nMINOR (${minor.length})\n${minor.join('\n')}\n`);
    bot.check(problems.length === 0, `${problems.length} problems:\n${problems.join('\n')}`);
  });
}
