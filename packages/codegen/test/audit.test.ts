import { describe, expect, it } from 'vitest';
import { auditProject, templateForProjectType, treeFromTemplate } from '../src/index.js';

const ids = (r: ReturnType<typeof auditProject>, sev: string) => r.checks.filter((c) => c.severity === sev).map((c) => c.id);

describe('auditProject', () => {
  it('flags real problems found in the files, with the files named', () => {
    const tree = new Map<string, string>([
      ['package.json', '{"dependencies":{"next":"15"}}'],
      ['next.config.ts', 'export default {}'],
      ['app/layout.tsx', 'export default function L({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}'],
      ['app/page.tsx', `'use client';\nexport default function P(){return <main><img src="/a.png"/><button/></main>}`],
      ['lib/keys.ts', 'export const k = "sk_live_abcdefghijklmnopqrstu";'],
    ]);
    const r = auditProject(tree);
    expect(r.kind).toBe('web');
    expect(ids(r, 'fail')).toEqual(expect.arrayContaining(['seo.metadata', 'a11y.lang', 'a11y.alt', 'sec.secrets']));
    expect(r.checks.find((c) => c.id === 'sec.secrets')!.files).toEqual(['lib/keys.ts']);
    expect(r.checks.find((c) => c.id === 'a11y.alt')!.files).toEqual(['app/page.tsx']);
    expect(r.score).toBeLessThan(60);
  });

  it('only cites files that exist and never leaks the secret value', () => {
    const tree = new Map([['package.json', '{}'], ['a.ts', 'const t="AKIAABCDEFGHIJKLMNOP"']]);
    const r = auditProject(tree);
    const json = JSON.stringify(r);
    expect(json).not.toContain('AKIAABCDEFGHIJKLMNOP');
    for (const c of r.checks) for (const f of c.files) expect(tree.has(f)).toBe(true);
  });

  it('scores a clean tree higher than a broken one and treats generated templates without crashing', () => {
    const site = auditProject(treeFromTemplate(templateForProjectType('website')!));
    const bad = auditProject(new Map([['app/page.tsx', "'use client';export default function P(){return <img src='x'/>}"], ['next.config.ts', '']]));
    expect(site.kind).toBe('web');
    expect(site.score).toBeGreaterThan(bad.score);
    expect(site.summary.pass + site.summary.warn + site.summary.fail).toBe(site.checks.length);
    const app = auditProject(treeFromTemplate(templateForProjectType('mobile_app')!));
    expect(app.kind).toBe('mobile');
    expect(app.checks.some((c) => c.id === 'mobile.ids')).toBe(true);
  });
});
