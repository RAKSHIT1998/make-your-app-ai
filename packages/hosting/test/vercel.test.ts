import { describe, expect, it } from 'vitest';
import { VercelHosting } from '../src/vercel.js';

function fakeVercel() {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const projects = new Map<string, { id: string; envs: { id: string; key: string }[] }>();
  const http = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: url.toString(), body, auth: new Headers(init?.headers).get('authorization') });
    const p = url.pathname;
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (method === 'GET' && p.startsWith('/v9/projects/') && p.split('/').length === 4) {
      const pr = projects.get(decodeURIComponent(p.split('/')[3]!));
      return pr ? json({ id: pr.id }) : json({ error: { code: 'not_found', message: 'Project not found' } }, 404);
    }
    if (method === 'POST' && p === '/v10/projects') { projects.set(body.name, { id: `prj_${body.name}`, envs: [{ id: 'env_old', key: 'OLD' }] }); return json({ id: `prj_${body.name}` }); }
    if (method === 'POST' && p === '/v13/deployments') return json({ id: 'dpl_1', url: 'site-abc.vercel.app', readyState: 'QUEUED' });
    if (method === 'GET' && p === '/v13/deployments/dpl_1') return json({ id: 'dpl_1', url: 'site-abc.vercel.app', readyState: 'ERROR', errorMessage: 'Build failed' });
    if (method === 'GET' && p.endsWith('/events')) return json([{ type: 'stdout', created: 1, text: 'Installing' }, { type: 'stderr', created: 2, payload: { text: 'Boom' } }]);
    if (method === 'GET' && p.endsWith('/env')) return json({ envs: projects.get('site')!.envs });
    if (method === 'DELETE' && p.includes('/env/')) return json({});
    if (method === 'POST' && p.endsWith('/env')) return json({ created: body });
    if (method === 'POST' && p.endsWith('/domains')) return json({ name: body.name, verified: false, verification: [{ type: 'TXT', domain: '_vercel.shop.example.com', value: 'vc-domain-verify=abc', reason: 'pending_domain_verification' }] });
    return json({ error: { message: `unhandled ${method} ${p}` } }, 500);
  }) as typeof fetch;
  return { http, calls };
}

describe('VercelHosting', () => {
  it('creates the site once, deploys files with the token server-side, and maps states', async () => {
    const f = fakeVercel();
    const v = new VercelHosting({ token: 'tok_secret', teamId: 'team_1' }, f.http);
    expect((await v.ensureSite('site', 'nextjs')).externalProjectId).toBe('prj_site');
    expect((await v.ensureSite('site', 'nextjs')).externalProjectId).toBe('prj_site');
    expect(f.calls.filter((c) => c.method === 'POST' && c.url.includes('/v10/projects'))).toHaveLength(1);
    const d = await v.deploy({ siteName: 'site', files: new Map([['app/page.tsx', 'export default 1']]), framework: 'nextjs', target: 'production' });
    expect(d).toMatchObject({ externalId: 'dpl_1', url: 'https://site-abc.vercel.app', state: 'queued' });
    const sent = f.calls.find((c) => c.url.includes('/v13/deployments'))!;
    expect(sent.auth).toBe('Bearer tok_secret');
    expect(sent.url).toContain('teamId=team_1');
    expect(sent.body).toMatchObject({ target: 'production', files: [{ file: 'app/page.tsx', data: 'export default 1', encoding: 'utf-8' }] });
    expect(await v.getDeployment('dpl_1')).toMatchObject({ state: 'error', errorMessage: 'Build failed' });
    expect((await v.logs('dpl_1')).map((l) => [l.type, l.text])).toEqual([['stdout', 'Installing'], ['stderr', 'Boom']]);
  });

  it('syncs env exactly (removes stale keys) and returns DNS instructions for domains', async () => {
    const f = fakeVercel();
    const v = new VercelHosting({ token: 't' }, f.http);
    await v.ensureSite('site', 'nextjs');
    await v.syncEnv('site', { API_KEY: 'x' });
    expect(f.calls.some((c) => c.method === 'DELETE' && c.url.includes('/env/env_old'))).toBe(true);
    expect(f.calls.find((c) => c.method === 'POST' && c.url.includes('/env'))!.body).toEqual([{ key: 'API_KEY', value: 'x', type: 'encrypted', target: ['production', 'preview'] }]);
    const dom = await v.addDomain('site', 'shop.example.com');
    expect(dom.records).toEqual([
      { type: 'CNAME', name: 'shop', value: 'cname.vercel-dns.com', reason: 'Points your subdomain at the site' },
      { type: 'TXT', name: '_vercel.shop.example.com', value: 'vc-domain-verify=abc', reason: 'Proves you own the domain' },
    ]);
  });
});
