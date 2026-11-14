import { storefrontScripts, type StorefrontConfig } from './storefront.js';
/**
 * Builds a single self-contained HTML document from a static web project (index.html + css + classic scripts)
 * so it can run in a sandboxed iframe. Pure string work: nothing here executes the project's code.
 */
import { appBackendScripts } from './appbackend.js';

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

export type PreviewResult = { ok: true; html: string; warnings: string[] } | { ok: false; reason: string };

const MAX_BYTES = 2_000_000;

function norm(ref: string): string | null {
  const clean = ref.split(/[?#]/)[0]!.trim();
  if (!clean || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) return null; // absolute / protocol-relative
  return clean.replace(/^\.\//, '').replace(/^\/+/, '');
}

const inlineSafe = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

export function isPreviewable(paths: Iterable<string>): boolean {
  for (const p of paths) if (p === 'index.html') return true;
  return false;
}

/**
 * `backend`: for full-stack apps, the page may reach exactly one origin (this app's data endpoint) and gets the `App`
 * SDK injected ahead of its own scripts. Everything else stays blocked.
 */
export function buildPreviewDocument(files: Record<string, string> | Map<string, string>, opts: { backend?: { api: string; env: 'preview' | 'live' }; store?: StorefrontConfig } = {}): PreviewResult {
  const get = (p: string) => (files instanceof Map ? files.get(p) : files[p]);
  const index = get('index.html');
  if (index === undefined) return { ok: false, reason: 'This project has no index.html, so there is nothing to run in the browser.' };
  const warnings: string[] = [];

  let html = index.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const p = href ? norm(href) : null;
    if (!p) { warnings.push(`Skipped external stylesheet ${href ?? ''}`.trim()); return ''; }
    const css = get(p);
    if (css === undefined) { warnings.push(`Missing stylesheet ${p}`); return ''; }
    return `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  });

  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!src) return tag;
    const p = norm(src);
    if (!p) { warnings.push(`Skipped external script ${src}`); return ''; }
    const code = get(p);
    if (code === undefined) { warnings.push(`Missing script ${p}`); return ''; }
    return `<script>\n${inlineSafe(code)}\n</script>`;
  });

  let csp = PREVIEW_CSP;
  let sdk = '';
  if (opts.backend) {
    const origin = new URL(opts.backend.api).origin;
    csp = csp.replace("connect-src 'none'", `connect-src ${origin}`);
    sdk = `\n${appBackendScripts(opts.backend)}`;
  }
  if (opts.store) {
    // A shop front may reach only its own store API, and show product photos from https links (catalogue images).
    const origin = new URL(opts.store.api).origin;
    csp = csp.replace(/connect-src [^;]+/, (m) => (m === "connect-src 'none'" ? `connect-src ${origin}` : m.includes(origin) ? m : `${m} ${origin}`)).replace('img-src data: blob:', 'img-src data: blob: https:');
    sdk += `\n${storefrontScripts(opts.store)}`;
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">${sdk}`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${meta}`) : `${meta}\n${html}`;
  if (Buffer_byteLength(html) > MAX_BYTES) return { ok: false, reason: 'The project is too large to preview (over 2 MB).' };
  return { ok: true, html, warnings };
}

function Buffer_byteLength(s: string) {
  return new TextEncoder().encode(s).length;
}
