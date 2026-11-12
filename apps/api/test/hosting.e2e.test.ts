import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider, type AiProvider, type CompletionRequest } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
import { FakeHosting } from '@mya/hosting';
import { HOSTING_HEALTH_CHECK, HOSTING_PROVIDER } from '../src/hosting/hosting.service.js';
import { DESIGN, HERO, HOME, ROOMS_LIB, ROOMS_PAGE, SPEC } from './fixtures.js';
const V = '/api/v1';

const json = (v: unknown) => JSON.stringify(v);
const CODE = json({ summary: 'Home + rooms', patches: [
  { op: 'create', path: 'components/Hero.tsx', content: HERO, reason: '' },
  { op: 'create', path: 'lib/rooms.ts', content: ROOMS_LIB, reason: '' },
  { op: 'update', path: 'app/page.tsx', content: HOME, reason: '' },
  { op: 'create', path: 'app/rooms/page.tsx', content: ROOMS_PAGE, reason: '' },
] });
const CREATE_SCRIPT = [json(SPEC), json(DESIGN), CODE];

/** Scripted provider whose replies are queued per test; optionally blocks until released. */
class QueueProvider implements AiProvider {
  readonly name = 'scripted';
  inner = new ScriptedProvider('scripted', []);
  gate: Promise<void> | null = null;
  queue(replies: string[]) {
    this.inner = new ScriptedProvider('scripted', [...replies]);
  }
  capabilities() {
    return { structuredOutput: true, maxOutputTokens: 64_000 };
  }
  async complete(model: string, req: CompletionRequest) {
    if (this.gate) await this.gate;
    return this.inner.complete(model, req);
  }
}

const provider = new QueueProvider();
const hosting = new FakeHosting(2);
const router = new ProviderRouter([provider], (['fast', 'balanced', 'deep'] as const).map((tier) => ({ provider: 'scripted', model: `m-${tier}`, tier, priority: 1, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true })), { sleep: async () => {} });

let app: INestApplication;
let prisma: PrismaClient;
let gen: GenerationsService;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ env: { ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), MAX_DEPLOYMENTS_PER_DAY: '6', DEPLOY_RATE_LIMIT_PER_MINUTE: '1000' }, overrides: [{ provide: AI_ROUTER, useValue: router }, { provide: HOSTING_PROVIDER, useValue: hosting }, { provide: HOSTING_HEALTH_CHECK, useValue: async (url: string) => ({ ok: !url.includes('unhealthy'), status: 200 }) }] }));
  gen = app.get(GenerationsService);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  provider.gate = null;
  await resetDb(prisma);
});

async function login(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = await http().get('/api/v1/me').set('Authorization', auth).expect(200);
  return { ...u, auth, orgId: me.body.personalOrgId as string };
}
async function newProject(auth: string, type = 'website') {
  return (await http().post('/api/v1/projects').set('Authorization', auth).send({ name: 'Grand Lake', type }).expect(201)).body.id as string;
}
async function generate(auth: string, projectId: string, prompt: string) {
  const res = await http().post(`/api/v1/projects/${projectId}/generations`).set('Authorization', auth).send({ prompt });
  if (res.status === 202) await gen.waitFor(res.body.id);
  return res;
}



async function siteFor(owner: { auth: string }) {
  const id = await newProject(owner.auth);
  provider.queue(CREATE_SCRIPT);
  await generate(owner.auth, id, 'A boutique lakeside hotel');
  return id;
}
const H = (id: string, auth: string) => http().get(`${V}/projects/${id}/hosting`).set('Authorization', auth).expect(200).then((r) => r.body);
async function settle(id: string, auth: string) {
  for (let i = 0; i < 6; i++) {
    const s = await H(id, auth);
    if (!['queued', 'building'].includes(s.deployments[0].status)) return s;
    await new Promise((r) => setTimeout(r, 2100));
  }
  throw new Error('deployment did not settle');
}
async function plan(flags: string[]) {
  await prisma.plan.update({ where: { code: 'free' }, data: { featureFlags: flags } });
}

describe('Cloud Studio hosting', () => {
  it('free plans can’t deploy; deploying needs a version; deploys are tracked to live with a health check', async () => {
    const a = await login('host-free');
    const id = await siteFor(a);
    expect((await H(id, a.auth)).entitlements).toEqual({ canDeploy: false, canUseCustomDomains: false });
    await http().post(`${V}/projects/${id}/deployments`).set('Authorization', a.auth).expect(402);

    await plan(['hosting_basic']);
    const b = await login('host-creator');
    const empty = await newProject(b.auth);
    await http().post(`${V}/projects/${empty}/deployments`).set('Authorization', b.auth).expect(400);
    const site = await siteFor(b);
    const d = (await http().post(`${V}/projects/${site}/deployments`).set('Authorization', b.auth).expect(201)).body;
    expect(d).toMatchObject({ status: 'queued', versionNumber: 1, kind: 'deploy' });
    await http().post(`${V}/projects/${site}/deployments`).set('Authorization', b.auth).expect(409); // one at a time
    const s = await settle(site, b.auth);
    expect(s.deployments[0]).toMatchObject({ status: 'live', current: true, health: { ok: true } });
    expect(s.site.productionUrl).toMatch(/^https:\/\//);
    const sent = [...hosting.deployments.values()].at(-1)!.req;
    expect(sent.files.get('lib/rooms.ts')).toBeTruthy();
    expect([...sent.files.keys()].some((p) => p.includes('.env'))).toBe(false);
    const logs = (await http().get(`${V}/projects/${site}/deployments/${d.id}/logs`).set('Authorization', b.auth).expect(200)).body;
    expect(logs[0].text).toMatch(/Building \d+ files/);
    // Other tenants can't see or deploy it.
    const c = await login('host-other');
    await http().get(`${V}/projects/${site}/hosting`).set('Authorization', c.auth).expect(404);
    await http().post(`${V}/projects/${site}/deployments`).set('Authorization', c.auth).expect(404);
  }, 30_000);

  it('failed builds are reported with the provider error; rollback redeploys an earlier version as a new deployment', async () => {
    await plan(['hosting_basic']);
    const a = await login('host-rollback');
    const id = await siteFor(a);
    const first = (await http().post(`${V}/projects/${id}/deployments`).set('Authorization', a.auth).expect(201)).body;
    await settle(id, a.auth);
    provider.queue([JSON.stringify({ summary: 'Penthouse', patches: [{ op: 'update', path: 'lib/rooms.ts', content: ROOMS_LIB.replace('Lake', 'Penthouse'), reason: '' }] })]);
    await generate(a.auth, id, 'Add a penthouse');
    hosting.failNext = true;
    await http().post(`${V}/projects/${id}/deployments`).set('Authorization', a.auth).expect(201);
    let s = await settle(id, a.auth);
    expect(s.deployments[0]).toMatchObject({ status: 'failed', versionNumber: 2, error: expect.stringContaining('Build failed') });
    expect(s.deployments[1]).toMatchObject({ id: first.id, current: true }); // the failed build didn't replace the live site
    await http().post(`${V}/projects/${id}/deployments/${s.deployments[0].id}/rollback`).set('Authorization', a.auth).expect(404); // can't roll back to a failed build
    const rb = (await http().post(`${V}/projects/${id}/deployments/${first.id}/rollback`).set('Authorization', a.auth).expect(201)).body;
    expect(rb).toMatchObject({ kind: 'rollback', versionNumber: 1 });
    s = await settle(id, a.auth);
    expect(s.deployments[0]).toMatchObject({ kind: 'rollback', status: 'live', current: true });
    expect([...hosting.deployments.values()].at(-1)!.req.files.get('lib/rooms.ts')).not.toContain('Penthouse');
  }, 40_000);

  it('env vars are encrypted, write-only, admin-only and synced to the provider on deploy', async () => {
    await plan(['hosting_basic']);
    const a = await login('host-env');
    const id = await siteFor(a);
    await http().put(`${V}/projects/${id}/env`).set('Authorization', a.auth).send({ key: 'bad key', value: 'x' }).expect(400);
    await http().put(`${V}/projects/${id}/env`).set('Authorization', a.auth).send({ key: 'VERCEL_TOKEN', value: 'x' }).expect(400);
    await http().put(`${V}/projects/${id}/env`).set('Authorization', a.auth).send({ key: 'RESEND_API_KEY', value: 're_live_secret' }).expect(200);
    await http().put(`${V}/projects/${id}/env`).set('Authorization', a.auth).send({ key: 'NEXT_PUBLIC_SITE_NAME', value: 'Grand Lake' }).expect(200);
    const s = await H(id, a.auth);
    expect(s.env).toEqual([{ key: 'NEXT_PUBLIC_SITE_NAME', updatedAt: expect.any(String), public: true }, { key: 'RESEND_API_KEY', updatedAt: expect.any(String), public: false }]);
    expect(JSON.stringify(s)).not.toContain('re_live_secret');
    const row = await prisma.projectEnvVar.findFirstOrThrow({ where: { projectId: id, key: 'RESEND_API_KEY' } });
    expect(row.encryptedValue).not.toContain('re_live_secret');
    await http().post(`${V}/projects/${id}/deployments`).set('Authorization', a.auth).expect(201);
    const siteName = (await prisma.hostingSite.findUniqueOrThrow({ where: { projectId: id } })).siteName;
    expect(hosting.env.get(siteName)).toEqual({ RESEND_API_KEY: 're_live_secret', NEXT_PUBLIC_SITE_NAME: 'Grand Lake' });
    await http().delete(`${V}/projects/${id}/env/RESEND_API_KEY`).set('Authorization', a.auth).expect(204);
    expect((await H(id, a.auth)).env).toHaveLength(1);
  });

  it('custom domains need Pro and a deployed site; DNS instructions come from the provider; status follows provider checks', async () => {
    await plan(['hosting_basic']);
    const a = await login('host-domain');
    const id = await siteFor(a);
    await http().post(`${V}/projects/${id}/domains`).set('Authorization', a.auth).send({ hostname: 'shop.example.com' }).expect(402);
    await plan(['hosting']);
    const b = await login('host-pro');
    const site = await siteFor(b);
    await http().post(`${V}/projects/${site}/domains`).set('Authorization', b.auth).send({ hostname: 'shop.example.com' }).expect(400); // not deployed yet
    await http().post(`${V}/projects/${site}/deployments`).set('Authorization', b.auth).expect(201);
    await http().post(`${V}/projects/${site}/domains`).set('Authorization', b.auth).send({ hostname: 'evil.vercel.app' }).expect(400);
    const dom = (await http().post(`${V}/projects/${site}/domains`).set('Authorization', b.auth).send({ hostname: 'Shop.Example.com' }).expect(201)).body;
    expect(dom).toMatchObject({ hostname: 'shop.example.com', status: 'pending_verification', records: [{ type: 'CNAME', name: 'shop' }] });
    await http().post(`${V}/projects/${site}/domains`).set('Authorization', b.auth).send({ hostname: 'shop.example.com' }).expect(409);
    hosting.domains.set('shop.example.com', { verified: true, configured: true });
    expect((await http().post(`${V}/projects/${site}/domains/shop.example.com/check`).set('Authorization', b.auth).expect(200)).body).toMatchObject({ status: 'active', sslStatus: 'issued_by_provider' });
    await http().delete(`${V}/projects/${site}/domains/shop.example.com`).set('Authorization', b.auth).expect(204);
    expect(hosting.domains.has('shop.example.com')).toBe(false);
  });

  it('enforces the daily deployment cap and the hosting kill switch', async () => {
    await plan(['hosting_basic']);
    const a = await login('host-cap');
    const id = await siteFor(a);
    const v = await prisma.projectVersion.findFirstOrThrow({ where: { projectId: id } });
    await prisma.hostingDeployment.createMany({ data: Array.from({ length: 6 }, () => ({ projectId: id, versionId: v.id, provider: 'fake', status: 'failed' as const })) });
    expect((await http().post(`${V}/projects/${id}/deployments`).set('Authorization', a.auth).expect(429)).body.code).toBe('hosting_daily_limit');
    await prisma.platformFlag.create({ data: { key: 'hosting', enabled: false } });
    await new Promise((r) => setTimeout(r, 5100));
    expect((await http().post(`${V}/projects/${id}/deployments`).set('Authorization', a.auth).expect(503)).body.code).toBe('feature_disabled');
    await prisma.platformFlag.delete({ where: { key: 'hosting' } });
  }, 20_000);
});
