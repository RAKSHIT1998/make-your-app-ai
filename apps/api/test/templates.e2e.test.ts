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




async function publishedProject(owner: { auth: string }) {
  const id = await newProject(owner.auth);
  provider.queue(CREATE_SCRIPT);
  await generate(owner.auth, id, 'A boutique lakeside hotel');
  await http().put(`${V}/projects/${id}/publishing`).set('Authorization', owner.auth).send({ visibility: 'public', publicTitle: 'Lake Hotel Starter', category: 'business' }).expect(200);
  return id;
}

describe('templates', () => {
  it('only published projects can be submitted; templates stay hidden until an owner approves them', async () => {
    const a = await login('tpl-creator');
    const draft = await newProject(a.auth);
    await http().put(`${V}/projects/${draft}/template`).set('Authorization', a.auth).send({}).expect(400);
    const id = await publishedProject(a);
    const sub = (await http().put(`${V}/projects/${id}/template`).set('Authorization', a.auth).send({ description: 'A calm hotel site to start from' }).expect(200)).body;
    expect(sub).toMatchObject({ status: 'pending', title: 'Lake Hotel Starter' });
    await http().put(`${V}/projects/${id}/template`).set('Authorization', a.auth).send({}).expect(409);
    expect((await http().get(`${V}/templates`).expect(200)).body).toHaveLength(0);
    await http().get(`${V}/templates/${sub.slug}`).expect(404);

    const mod = await login('tpl-mod');
    await http().post(`${V}/admin/templates/${'0'.repeat(8)}-0000-0000-0000-000000000000/review`).set('Authorization', mod.auth).send({ decision: 'approve' }).expect(404);
    await prisma.user.update({ where: { id: mod.id }, data: { platformRole: 'admin' } });
    const q = (await http().get(`${V}/admin/templates?status=pending`).set('Authorization', mod.auth).expect(200)).body;
    expect(q).toHaveLength(1);
    await http().post(`${V}/admin/templates/${q[0].id}/review`).set('Authorization', mod.auth).send({ decision: 'feature' }).expect(400); // not approved yet
    await http().post(`${V}/admin/templates/${q[0].id}/review`).set('Authorization', mod.auth).send({ decision: 'approve' }).expect(201);
    const list = (await http().get(`${V}/templates`).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Lake Hotel Starter', free: true, uses: 0, category: 'business' });
    expect(list[0].pages.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toContain('@example.test'); // no emails
  });

  it('using a template creates a separate project from the frozen files; later edits never leak; withdrawal hides it', async () => {
    const a = await login('tpl-owner');
    const id = await publishedProject(a);
    const sub = (await http().put(`${V}/projects/${id}/template`).set('Authorization', a.auth).send({}).expect(200)).body;
    await prisma.template.update({ where: { slug: sub.slug }, data: { status: 'approved' } });
    provider.queue([JSON.stringify({ summary: 'Secret edit', patches: [{ op: 'update', path: 'lib/rooms.ts', content: 'export const rooms = [];\n// PRIVATE DRAFT', reason: '' }] })]);
    await generate(a.auth, id, 'private change');

    const b = await login('tpl-user');
    await http().post(`${V}/templates/${sub.slug}/use`).send({}).expect(401);
    const p = (await http().post(`${V}/templates/${sub.slug}/use`).set('Authorization', b.auth).send({ name: 'My Hotel' }).expect(201)).body;
    expect(p).toMatchObject({ name: 'My Hotel', status: 'ready', organizationId: b.orgId });
    const rooms = (await http().get(`${V}/projects/${p.id}/file?path=lib/rooms.ts`).set('Authorization', b.auth)).body;
    expect(JSON.stringify(rooms)).not.toContain('PRIVATE DRAFT');
    expect((await http().get(`${V}/projects/${p.id}/versions`).set('Authorization', b.auth)).body[0].message).toContain('template');
    await http().get(`${V}/projects/${id}`).set('Authorization', b.auth).expect(404);
    expect((await http().get(`${V}/templates/${sub.slug}`)).body.uses).toBe(1);

    await http().delete(`${V}/projects/${id}/template`).set('Authorization', b.auth).expect(404); // not theirs
    await http().delete(`${V}/projects/${id}/template`).set('Authorization', a.auth).expect(200);
    await http().get(`${V}/templates/${sub.slug}`).expect(404);
    await http().post(`${V}/templates/${sub.slug}/use`).set('Authorization', b.auth).send({}).expect(404);
  });
});
