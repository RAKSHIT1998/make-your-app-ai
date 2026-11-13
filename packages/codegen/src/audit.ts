import type { FileTree } from './patch.js';

export type AuditSeverity = 'pass' | 'warn' | 'fail';
export type AuditCategory = 'seo' | 'accessibility' | 'performance' | 'security' | 'mobile';
export interface AuditCheck {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  detail: string;
  /** Files the finding is about (only files that exist in the project). */
  files: string[];
  fix?: string;
}
export interface AuditReport {
  kind: 'web' | 'mobile' | 'unknown';
  score: number;
  filesScanned: number;
  checks: AuditCheck[];
  summary: Record<AuditSeverity, number>;
}

const SOURCE = /\.(tsx?|jsx?|html|mdx?)$/;
const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/sk_live_[A-Za-z0-9]{16,}/, 'a Stripe live secret key'],
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key id'],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, 'a private key'],
  [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'a signed token (JWT)'],
];

const files = (tree: FileTree, re: RegExp) => [...tree.keys()].filter((p) => re.test(p));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/**
 * Static review of what is actually in the project. Every finding is derived from file contents;
 * nothing here measures live traffic or rendered pages, and the wording says so.
 */
export function auditProject(tree: FileTree): AuditReport {
  const isNext = tree.has('next.config.ts') || tree.has('next.config.js') || tree.has('next.config.mjs') || [...tree.keys()].some((p) => /^(src\/)?app\/.+\.(tsx|jsx)$/.test(p));
  const isExpo = tree.has('app.json') && /"expo"/.test(tree.get('package.json') ?? '');
  const kind: AuditReport['kind'] = isExpo ? 'mobile' : isNext ? 'web' : 'unknown';
  const checks: AuditCheck[] = [];
  const add = (c: AuditCheck) => checks.push(c);
  const src = [...tree.entries()].filter(([p]) => SOURCE.test(p));

  if (kind === 'web' || kind === 'unknown') {
    const layouts = files(tree, /^(src\/)?app\/layout\.(tsx|jsx)$/);
    const pages = files(tree, /^(src\/)?app\/(.+\/)?page\.(tsx|jsx)$/);
    const layoutText = layouts.map((p) => tree.get(p) ?? '').join('\n');
    const pageText = (p: string) => tree.get(p) ?? '';
    const hasMeta = (t: string) => /export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)/.test(t);

    const noMeta = pages.filter((p) => !hasMeta(pageText(p)) && !hasMeta(layoutText));
    add(noMeta.length === 0 && pages.length > 0
      ? { id: 'seo.metadata', category: 'seo', severity: 'pass', title: 'Pages have titles and descriptions', detail: 'A metadata export covers every page.', files: [] }
      : { id: 'seo.metadata', category: 'seo', severity: pages.length === 0 ? 'warn' : 'fail', title: 'Missing page metadata', detail: pages.length === 0 ? 'No page routes were found to check.' : `${noMeta.length} page(s) have no title or description export, so search results will show a generic snippet.`, files: noMeta.slice(0, 8), fix: 'Export `metadata` with a unique title and description from each page or the root layout.' });

    const metaText = [layoutText, ...pages.map(pageText)].join('\n');
    add(/description\s*:/.test(metaText)
      ? { id: 'seo.description', category: 'seo', severity: 'pass', title: 'Meta description present', detail: 'A description is defined in metadata.', files: [] }
      : { id: 'seo.description', category: 'seo', severity: 'warn', title: 'No meta description', detail: 'Search engines will pick arbitrary text for the snippet.', files: layouts, fix: 'Add a 120–160 character `description` to the root metadata.' });

    add(/openGraph|og:title/.test(metaText)
      ? { id: 'seo.social', category: 'seo', severity: 'pass', title: 'Social sharing tags present', detail: 'Open Graph metadata found.', files: [] }
      : { id: 'seo.social', category: 'seo', severity: 'warn', title: 'No social preview tags', detail: 'Links shared on social apps and chat will show no title, description or image.', files: layouts, fix: 'Add `openGraph` (title, description, images) to metadata.' });

    const hasSitemap = files(tree, /^(src\/)?app\/sitemap\.(ts|js|xml)$/).length > 0 || tree.has('public/sitemap.xml');
    const hasRobots = files(tree, /^(src\/)?app\/robots\.(ts|js|txt)$/).length > 0 || tree.has('public/robots.txt');
    add(hasSitemap ? { id: 'seo.sitemap', category: 'seo', severity: 'pass', title: 'Sitemap present', detail: 'A sitemap is generated.', files: [] } : { id: 'seo.sitemap', category: 'seo', severity: 'warn', title: 'No sitemap', detail: 'Crawlers must discover pages by following links only.', files: [], fix: 'Add `app/sitemap.ts` listing your public URLs.' });
    add(hasRobots ? { id: 'seo.robots', category: 'seo', severity: 'pass', title: 'robots rules present', detail: 'A robots file is defined.', files: [] } : { id: 'seo.robots', category: 'seo', severity: 'warn', title: 'No robots file', detail: 'Crawl rules are left to defaults.', files: [], fix: 'Add `app/robots.ts` and point it at your sitemap.' });

    const h1Missing = pages.filter((p) => !/<h1[\s>]/.test(pageText(p)) && !/<h1[\s>]/.test(layoutText));
    add(pages.length && h1Missing.length === 0
      ? { id: 'seo.h1', category: 'seo', severity: 'pass', title: 'Every page has a main heading', detail: 'An h1 is rendered on each page file.', files: [] }
      : { id: 'seo.h1', category: 'seo', severity: pages.length ? 'warn' : 'pass', title: 'Pages without an h1', detail: `${h1Missing.length} page file(s) have no <h1> directly in them (a shared component may supply one).`, files: h1Missing.slice(0, 8), fix: 'Give each page exactly one descriptive <h1>.' });

    add(/<html[^>]*\blang=/.test(layoutText)
      ? { id: 'a11y.lang', category: 'accessibility', severity: 'pass', title: 'Page language declared', detail: '<html lang> is set.', files: [] }
      : { id: 'a11y.lang', category: 'accessibility', severity: layouts.length ? 'fail' : 'warn', title: 'Page language not declared', detail: 'Screen readers cannot choose the right voice without <html lang>.', files: layouts, fix: 'Use `<html lang="en">` in the root layout.' });

    const imgNoAlt: string[] = []; let imgTotal = 0;
    for (const [p, t] of src) {
      const tags = t.match(/<(?:img|Image)\b[^>]*>/g) ?? [];
      imgTotal += tags.length;
      if (tags.some((tag) => !/\balt\s*=/.test(tag))) imgNoAlt.push(p);
    }
    add(imgNoAlt.length === 0
      ? { id: 'a11y.alt', category: 'accessibility', severity: 'pass', title: imgTotal ? 'Images have alt text' : 'No images to check', detail: imgTotal ? `${imgTotal} image tag(s) all declare alt.` : 'No <img> or <Image> tags found.', files: [] }
      : { id: 'a11y.alt', category: 'accessibility', severity: 'fail', title: 'Images without alt text', detail: `Found in ${imgNoAlt.length} file(s). Use alt="" for decorative images.`, files: imgNoAlt.slice(0, 8), fix: 'Add a short descriptive `alt` to each image.' });

    const btnNoName = src.filter(([, t]) => /<button\b[^>]*\/>/.test(t) || /<button\b[^>]*>\s*<(svg|Icon)[^>]*\/?>\s*<\/button>/.test(t)).map(([p]) => p);
    add(btnNoName.length === 0
      ? { id: 'a11y.buttons', category: 'accessibility', severity: 'pass', title: 'No icon-only buttons detected', detail: 'Buttons appear to carry text.', files: [] }
      : { id: 'a11y.buttons', category: 'accessibility', severity: 'warn', title: 'Possible icon-only buttons', detail: 'Buttons with no text need an accessible name.', files: btnNoName.slice(0, 8), fix: 'Add `aria-label` to icon-only buttons.' });

    const viewportOk = /viewport/.test(layoutText) || isNext; // Next adds the viewport meta by default
    add(viewportOk ? { id: 'mobile.viewport', category: 'mobile', severity: 'pass', title: 'Responsive viewport', detail: 'Next.js sets the viewport meta tag by default.', files: [] } : { id: 'mobile.viewport', category: 'mobile', severity: 'fail', title: 'No viewport meta', detail: 'Phones will render the page at desktop width.', files: [], fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' });

    const rawImg = src.filter(([, t]) => /<img\b/.test(t)).map(([p]) => p);
    add(rawImg.length === 0
      ? { id: 'perf.images', category: 'performance', severity: 'pass', title: 'Optimised images', detail: 'No raw <img> tags; next/image is used or there are no images.', files: [] }
      : { id: 'perf.images', category: 'performance', severity: 'warn', title: 'Unoptimised <img> tags', detail: 'Raw images skip resizing, lazy loading and modern formats.', files: rawImg.slice(0, 8), fix: 'Use `next/image` for content images.' });

    const clientPages = pages.filter((p) => /^['"]use client['"]/.test(pageText(p).trimStart()));
    add(pages.length && clientPages.length > pages.length / 2
      ? { id: 'perf.client', category: 'performance', severity: 'warn', title: 'Most pages render on the client', detail: `${clientPages.length} of ${pages.length} pages start with "use client", which ships more JavaScript and weakens SEO.`, files: clientPages.slice(0, 8), fix: 'Keep pages as server components and move interactivity into small client components.' }
      : { id: 'perf.client', category: 'performance', severity: 'pass', title: 'Pages are mostly server-rendered', detail: 'Less JavaScript is sent to the browser.', files: [] });

    const heavy = [...tree.entries()].filter(([p, t]) => SOURCE.test(p) && t.length > 40_000).map(([p]) => p);
    add(heavy.length === 0 ? { id: 'perf.size', category: 'performance', severity: 'pass', title: 'No oversized source files', detail: 'All source files are under 40 KB.', files: [] } : { id: 'perf.size', category: 'performance', severity: 'warn', title: 'Very large source files', detail: 'Large files are slow to load and hard to maintain.', files: heavy.slice(0, 8), fix: 'Split large components into smaller ones.' });
  }

  if (kind === 'mobile') {
    const app = (() => { try { return (JSON.parse(tree.get('app.json') ?? '{}') as { expo?: Record<string, unknown> }).expo ?? {}; } catch { return null; } })();
    add(app === null
      ? { id: 'mobile.config', category: 'mobile', severity: 'fail', title: 'app.json is not valid JSON', detail: 'The app cannot be built until this parses.', files: ['app.json'] }
      : { id: 'mobile.config', category: 'mobile', severity: 'pass', title: 'app.json parses', detail: 'Expo configuration is valid JSON.', files: [] });
    const a = app ?? {};
    const ios = (a.ios ?? {}) as Record<string, unknown>; const android = (a.android ?? {}) as Record<string, unknown>;
    add(ios.bundleIdentifier && android.package
      ? { id: 'mobile.ids', category: 'mobile', severity: 'pass', title: 'Store identifiers set', detail: 'iOS bundle identifier and Android package are defined.', files: [] }
      : { id: 'mobile.ids', category: 'mobile', severity: 'fail', title: 'Store identifiers missing', detail: 'Store builds need a bundle identifier and an Android package.', files: ['app.json'], fix: 'Set `expo.ios.bundleIdentifier` and `expo.android.package`.' });
    add(a.icon ? { id: 'mobile.icon', category: 'mobile', severity: 'pass', title: 'App icon configured', detail: 'An icon path is set.', files: [] } : { id: 'mobile.icon', category: 'mobile', severity: 'warn', title: 'No app icon', detail: 'Stores require a 1024×1024 icon.', files: ['app.json'], fix: 'Add `expo.icon` pointing to a 1024×1024 PNG.' });
    add(a.version ? { id: 'mobile.version', category: 'mobile', severity: 'pass', title: 'Version set', detail: `Version ${String(a.version)}.`, files: [] } : { id: 'mobile.version', category: 'mobile', severity: 'warn', title: 'No version', detail: 'Stores require a version string.', files: ['app.json'] });
    const a11yLabels = src.filter(([, t]) => /<(Pressable|TouchableOpacity)\b/.test(t) && !/accessibilityLabel|accessibilityRole/.test(t)).map(([p]) => p);
    add(a11yLabels.length === 0 ? { id: 'a11y.native', category: 'accessibility', severity: 'pass', title: 'Touch targets labelled', detail: 'Pressables declare accessibility props, or none are used.', files: [] } : { id: 'a11y.native', category: 'accessibility', severity: 'warn', title: 'Pressables without accessibility labels', detail: 'Screen reader users cannot tell what these do.', files: a11yLabels.slice(0, 8), fix: 'Add `accessibilityLabel` and `accessibilityRole`.' });
  }

  // Security applies to every project.
  const leaks: string[] = []; const what = new Set<string>();
  for (const [p, t] of tree) {
    if (/(^|\/)\.env/.test(p) && !/\.example$/.test(p)) { leaks.push(p); what.add('an env file'); continue; }
    if (!SOURCE.test(p) && !/\.(json|ya?ml|env|txt)$/.test(p)) continue;
    for (const [re, label] of SECRET_PATTERNS) if (re.test(t)) { leaks.push(p); what.add(label); }
  }
  add(leaks.length === 0
    ? { id: 'sec.secrets', category: 'security', severity: 'pass', title: 'No secrets found in files', detail: 'No key or token patterns were found.', files: [] }
    : { id: 'sec.secrets', category: 'security', severity: 'fail', title: 'Possible secret in source', detail: `Looks like ${[...what].join(', ')}. Anyone with the code can read it.`, files: [...new Set(leaks)].slice(0, 8), fix: 'Remove it, rotate the credential, and read it from an environment variable instead.' });

  const clientEnv = src.filter(([, t]) => /process\.env\.(?!NEXT_PUBLIC_|EXPO_PUBLIC_|NODE_ENV)[A-Z_]*(SECRET|PRIVATE|SERVICE_ROLE)[A-Z_]*/.test(t) && /^['"]use client['"]/.test(t.trimStart())).map(([p]) => p);
  add(clientEnv.length === 0 ? { id: 'sec.clientenv', category: 'security', severity: 'pass', title: 'No server secrets read in client code', detail: 'Client files do not reference secret-looking variables.', files: [] } : { id: 'sec.clientenv', category: 'security', severity: 'fail', title: 'Server secret read in a client component', detail: 'Client code is sent to the browser.', files: clientEnv.slice(0, 8), fix: 'Read it in a server route and return only what the page needs.' });

  const html = src.filter(([, t]) => /dangerouslySetInnerHTML|\beval\(|new Function\(/.test(t)).map(([p]) => p);
  add(html.length === 0 ? { id: 'sec.xss', category: 'security', severity: 'pass', title: 'No raw HTML injection or eval', detail: 'No dangerouslySetInnerHTML, eval or new Function.', files: [] } : { id: 'sec.xss', category: 'security', severity: 'warn', title: 'Raw HTML or eval used', detail: 'Unsanitised content here can run attacker scripts.', files: html.slice(0, 8), fix: 'Render text normally or sanitise the HTML first.' });

  const weight = { fail: 1, warn: 0.5, pass: 0 } as const;
  const score = checks.length ? Math.round(100 - (checks.reduce((n, c) => n + weight[c.severity], 0) / checks.length) * 100) : 0;
  const summary = { pass: 0, warn: 0, fail: 0 } as Record<AuditSeverity, number>;
  for (const c of checks) summary[c.severity]++;
  return { kind, score, filesScanned: tree.size, checks, summary };
}
