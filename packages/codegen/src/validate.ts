import { builtinModules } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import type { FileTree } from './patch.js';
import { APP_BACKEND_FILE, parseAppBackend } from '@mya/shared';

export interface ValidationIssue {
  file: string;
  message: string;
}

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'];
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const BUILTINS = new Set(builtinModules);

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** Reads `compilerOptions.paths` aliases such as "@/*": ["./*"] from tsconfig.json. */
function readAliases(tree: FileTree): [string, string][] {
  const raw = tree.get('tsconfig.json');
  if (!raw) return [];
  try {
    const paths = (JSON.parse(raw) as { compilerOptions?: { paths?: Record<string, string[]> } }).compilerOptions?.paths ?? {};
    return Object.entries(paths).flatMap(([k, v]) => (v[0] ? [[k.replace(/\*$/, ''), v[0].replace(/\*$/, '').replace(/^\.\//, '')] as [string, string]] : []));
  } catch {
    return [];
  }
}

/**
 * Static checks that catch the most common generation failures before spending sandbox time:
 * unresolved relative/alias imports, imports of undeclared packages, and invalid JSON config.
 */
export function validateTree(tree: FileTree): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (tree.has('index.html')) issues.push(...validateStaticWeb(tree));
  if (tree.has('index.html') || tree.has(APP_BACKEND_FILE)) issues.push(...validateAppBackend(tree));
  let deps = new Set<string>();
  const pkgRaw = tree.get('package.json');
  if (!pkgRaw) issues.push({ file: 'package.json', message: 'Missing package.json' });
  else {
    try {
      const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    } catch {
      issues.push({ file: 'package.json', message: 'package.json is not valid JSON' });
    }
  }
  for (const f of ['tsconfig.json']) {
    const raw = tree.get(f);
    if (raw) {
      try {
        JSON.parse(raw);
      } catch {
        issues.push({ file: f, message: `${f} is not valid JSON` });
      }
    }
  }
  const aliases = readAliases(tree);
  const exists = (p: string) => RESOLVE_EXT.some((ext) => tree.has(path.posix.normalize(p + ext)));

  for (const [file, content] of tree) {
    if (!CODE_EXT.test(file)) continue;
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of stripped.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      if (spec.startsWith('.')) {
        const target = path.posix.join(path.posix.dirname(file), spec);
        if (!exists(target)) issues.push({ file, message: `Unresolved import "${spec}"` });
        continue;
      }
      const alias = aliases.find(([prefix]) => spec.startsWith(prefix));
      if (alias) {
        const target = path.posix.join(alias[1], spec.slice(alias[0].length));
        if (!exists(target)) issues.push({ file, message: `Unresolved import "${spec}"` });
        continue;
      }
      if (spec.startsWith('node:') || BUILTINS.has(spec) || BUILTINS.has(packageName(spec))) continue;
      if (!deps.has(packageName(spec))) issues.push({ file, message: `Package "${packageName(spec)}" is imported but not declared in package.json` });
    }
  }
  return issues;
}

const NETWORK_API = /\b(fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(|navigator\.sendBeacon|importScripts\s*\()/;
const ES_MODULE_SYNTAX = /^\s*(import\s+[\w*{'"]|export\s+(default|const|function|class|let|var|\{))/m;

/**
 * Checks for static HTML/CSS/JS projects (games and small web apps) that run in a sandboxed preview:
 * local references resolve, nothing is loaded from the network, scripts are classic scripts that compile.
 */
export function validateStaticWeb(tree: FileTree): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const html = tree.get('index.html') ?? '';
  const resolve = (ref: string) => ref.split(/[?#]/)[0]!.replace(/^\.\//, '').replace(/^\/+/, '');
  const isRemote = (ref: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) && !/^(data|blob):/i.test(ref);
  const scriptFiles: string[] = [];

  for (const m of html.matchAll(/<(script|link|img|source|audio|video)\b([^>]*)>/gi)) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2]!;
    const ref = (tag === 'link' ? /href\s*=\s*["']([^"']+)["']/i : /src\s*=\s*["']([^"']+)["']/i).exec(attrs)?.[1];
    if (tag === 'link' && !/rel\s*=\s*["']?(stylesheet|icon)/i.test(attrs)) continue;
    if (tag === 'script' && /type\s*=\s*["']module["']/i.test(attrs)) issues.push({ file: 'index.html', message: 'Use classic <script src="app.js"></script> tags, not type="module" (the preview inlines scripts).' });
    if (!ref) continue;
    if (isRemote(ref)) { issues.push({ file: 'index.html', message: `"${ref}" loads from the network. The preview blocks network access; inline it or use a data: URI.` }); continue; }
    if (/^(data|blob):/i.test(ref)) continue;
    const target = resolve(ref);
    if (!tree.has(target)) issues.push({ file: 'index.html', message: `References "${ref}" but no such file exists.` });
    else if (tag === 'script') scriptFiles.push(target);
  }
  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)) issues.push({ file: 'index.html', message: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so it works on phones.' });

  const sources: [string, string][] = scriptFiles.map((f) => [f, tree.get(f)!]);
  html.replace(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_m, code: string) => { if (code.trim()) sources.push(['index.html', code]); return ''; });
  for (const [file, code] of sources) {
    if (ES_MODULE_SYNTAX.test(code)) issues.push({ file, message: 'Uses import/export. Put everything in classic scripts that share globals, loaded in order.' });
    try {
      new vm.Script(code, { filename: file }); // compiles only; never executed
    } catch (e) {
      issues.push({ file, message: `Syntax error: ${(e as Error).message}` });
    }
    const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const net = NETWORK_API.exec(stripped);
    if (net) issues.push({ file, message: tree.has(APP_BACKEND_FILE) ? `Uses ${net[1]!.replace(/\s*\($/, '')}. Talk to the backend only through App.db and App.auth.` : `Uses ${net[1]!.replace(/\s*\($/, '')}, which is blocked in the sandboxed preview. Keep state in memory or localStorage.` });
  }
  return issues;
}

const DB_CALL = /\bApp\.db\.(list|get|create|update|remove)\(\s*(['"`])([^'"`]+)\2/g;

/**
 * Checks the built-in backend contract: app.backend.json is valid, every collection the code uses is declared, the
 * code uses the platform's `App` object only when a backend exists, and never redefines it.
 */
export function validateAppBackend(tree: FileTree): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const raw = tree.get(APP_BACKEND_FILE);
  const parsed = raw === undefined ? null : parseAppBackend(raw);
  if (parsed && !parsed.ok) for (const e of parsed.errors) issues.push({ file: APP_BACKEND_FILE, message: e });
  const backend = parsed?.ok ? parsed.backend : null;
  for (const [file, code] of tree) {
    if (!/\.(js|html)$/.test(file)) continue;
    const uses = /\bApp\.(db|auth|ready|services)\b/.test(code);
    if (uses && raw === undefined) { issues.push({ file, message: `Uses App.db/App.auth but there is no ${APP_BACKEND_FILE}. Declare the collections and access rules there.` }); continue; }
    if (/(\bwindow\.App\s*=|\b(const|let|var|function|class)\s+App\b)/.test(code)) issues.push({ file, message: 'Redefines App. The platform provides App; use it, never define it.' });
    if (!backend) continue;
    if (/\bApp\.auth\.(signUp|signIn)\b/.test(code) && !backend.auth.enabled) issues.push({ file, message: `Uses sign-in, but ${APP_BACKEND_FILE} has "auth": { "enabled": false }.` });
    for (const m of code.matchAll(DB_CALL)) if (!backend.collections[m[3]!]) issues.push({ file, message: `Uses collection "${m[3]}" which is not declared in ${APP_BACKEND_FILE}.` });
  }
  return issues;
}
