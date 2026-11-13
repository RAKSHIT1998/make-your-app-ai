import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildPreviewDocument } from '@mya/shared';
import { BREAKOUT } from './fixtures/breakout.js';
import { GitProjectStore, PatchError, applyPatches, getTemplate, safePath, templateForProjectType, treeFromTemplate, validateTree } from '../src/index.js';

describe('safePath', () => {
  it.each(['../etc/passwd', '/etc/passwd', 'a/../../b', '.git/config', 'node_modules/x/index.js', '.env', 'config/.env.local', 'a\\b', 'x\0y'])('rejects %s', (p) => {
    expect(() => safePath(p)).toThrow(PatchError);
  });
  it('normalises benign paths', () => {
    expect(safePath('./app//page.tsx')).toBe('app/page.tsx');
  });
});

describe('applyPatches', () => {
  const base = new Map([['a.ts', Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')], ['b.ts', 'x']]);
  it('creates, updates, deletes without mutating input', () => {
    const { tree, summary } = applyPatches(base, [
      { op: 'create', path: 'c.ts', content: 'new', reason: '' },
      { op: 'update', path: 'b.ts', content: 'y', reason: '' },
      { op: 'delete', path: 'a.ts', reason: '' },
    ]);
    expect([...tree.keys()].sort()).toEqual(['b.ts', 'c.ts']);
    expect(base.has('a.ts')).toBe(true);
    expect(summary).toMatchObject({ created: ['c.ts'], updated: ['b.ts'], deleted: ['a.ts'], destructive: ['a.ts'] });
  });
  it('flags large rewrites as destructive but not small edits', () => {
    const small = applyPatches(base, [{ op: 'update', path: 'a.ts', content: base.get('a.ts')!.replace('line 3', 'line three'), reason: '' }]);
    expect(small.summary.destructive).toEqual([]);
    const big = applyPatches(base, [{ op: 'update', path: 'a.ts', content: 'totally new', reason: '' }]);
    expect(big.summary.destructive).toEqual(['a.ts']);
  });
  it('rejects deleting missing files and content-less writes', () => {
    expect(() => applyPatches(base, [{ op: 'delete', path: 'zzz.ts', reason: '' }])).toThrow();
    expect(() => applyPatches(base, [{ op: 'create', path: 'z.ts', reason: '' }])).toThrow();
  });
});

describe('validateTree', () => {
  const tpl = treeFromTemplate(templateForProjectType('website')!);
  it('passes the pristine template', () => {
    expect(validateTree(tpl)).toEqual([]);
  });
  it('catches missing components, undeclared packages and broken JSON', () => {
    const { tree } = applyPatches(tpl, [
      { op: 'update', path: 'app/page.tsx', content: "import { Hero } from '@/components/Hero';\nimport x from 'framer-motion';\nimport { y } from './missing';\nimport fs from 'node:fs';\nexport default function P(){return <Hero/>}", reason: '' },
      { op: 'update', path: 'tsconfig.json', content: '{ nope', reason: '' },
    ]);
    const msgs = validateTree(tree).map((i) => i.message);
    expect(msgs).toContain('tsconfig.json is not valid JSON');
    expect(msgs.some((m) => m.includes('framer-motion'))).toBe(true);
    expect(msgs.some((m) => m.includes('./missing'))).toBe(true);
    expect(msgs.some((m) => m.includes('node:fs'))).toBe(false);
  });
  it('resolves alias imports once the file exists', () => {
    const { tree } = applyPatches(tpl, [
      { op: 'create', path: 'components/Hero.tsx', content: 'export function Hero(){return null}', reason: '' },
      { op: 'update', path: 'app/page.tsx', content: "import { Hero } from '@/components/Hero';\nexport default function P(){return <Hero/>}", reason: '' },
    ]);
    expect(validateTree(tree)).toEqual([]);
  });
});

describe('GitProjectStore', () => {
  it('commits trees, reads them back, and keeps history', async () => {
    const store = new GitProjectStore(await mkdtemp(path.join(tmpdir(), 'mya-git-')));
    const id = randomUUID();
    const sha1 = await store.commit(id, new Map([['a.txt', 'one'], ['dir/b.txt', 'two']]), 'v1');
    const sha2 = await store.commit(id, new Map([['a.txt', 'one!']]), 'v2');
    expect(sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(await store.commit(id, new Map([['a.txt', 'one!']]), 'noop')).toBeNull();
    expect(Object.fromEntries(await store.readTree(id))).toEqual({ 'a.txt': 'one!' });
    expect(Object.fromEntries(await store.readTree(id, sha1!))).toEqual({ 'a.txt': 'one', 'dir/b.txt': 'two' });
    expect((await store.log(id)).map((l) => l.sha)).toEqual([sha2, sha1]);
  });
  it('rejects non-uuid project ids', () => {
    expect(() => new GitProjectStore('/tmp').repoPath('../x')).toThrow();
  });
  it('looks up templates by versioned key', () => {
    expect(getTemplate('nextjs-site@1')?.id).toBe('nextjs-site');
    expect(getTemplate('nextjs-site@99')).toBeUndefined();
  });
});

describe('static web projects (games and browser apps)', () => {
  const play = getTemplate('web-play@1')!;
  const game = () => new Map<string, string>([...treeFromTemplate(play), ...Object.entries(BREAKOUT)]);

  it('is the template for games and browser apps', () => {
    expect(templateForProjectType('game')?.id).toBe('web-play');
    expect(templateForProjectType('custom_software')?.id).toBe('web-play');
    expect(validateTree(treeFromTemplate(play))).toEqual([]);
  });
  it('accepts a real playable game', () => {
    expect(validateTree(game())).toEqual([]);
  });
  it('rejects missing files, network loads, modules, syntax errors and network APIs', () => {
    const t = game();
    t.set('index.html', t.get('index.html')!.replace('</body>', '<script src="https://cdn.example.com/phaser.js"></script><script src="missing.js"></script><script type="module" src="app.js"></script></body>'));
    t.set('app.js', `${t.get('app.js')!}\nfetch('/api/score');`);
    const msgs = validateTree(t).map((i) => i.message).join('\n');
    expect(msgs).toContain('loads from the network');
    expect(msgs).toContain('no such file exists');
    expect(msgs).toContain('type="module"');
    expect(msgs).toContain('fetch');
    const broken = game();
    broken.set('app.js', 'function (');
    expect(validateTree(broken).some((i) => i.message.startsWith('Syntax error'))).toBe(true);
    const mod = game();
    mod.set('app.js', `import x from './y.js';\n${mod.get('app.js')!}`);
    expect(validateTree(mod).some((i) => i.message.includes('import/export'))).toBe(true);
  });
  it('builds a sandboxed preview document with inlined assets and a strict CSP', () => {
    const r = buildPreviewDocument(game());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('Content-Security-Policy');
    expect(r.html).toContain("connect-src 'none'");
    expect(r.html).toContain('<style>');
    expect(r.html).not.toContain('src="app.js"');
    expect(r.html).toContain('requestAnimationFrame');
    expect(r.warnings).toEqual([]);
    expect(buildPreviewDocument(new Map([['a.txt', 'x']]))).toMatchObject({ ok: false });
  });
  it('cannot be broken out of by script text in the project', () => {
    const t = game();
    t.set('app.js', 'document.title = "</script><img src=x onerror=alert(1)>";');
    const r = buildPreviewDocument(t);
    expect(r.ok && r.html.includes('</script><img')).toBe(false);
  });
});
