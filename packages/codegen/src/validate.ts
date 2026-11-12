import { builtinModules } from 'node:module';
import path from 'node:path';
import type { FileTree } from './patch.js';

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
