import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderError, ProviderRouter, ScriptedProvider, type ModelRoute } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER, refreshRouting } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
import { DESIGN, HERO, HOME, ROOMS_LIB, ROOMS_PAGE, SPEC } from './fixtures.js';
const V = '/api/v1';
const OWNER_EMAIL = 'owner-routing@example.com';
const j = JSON.stringify;
const CODE_REPLY = j({ summary: 'Home + rooms', patches: [
  { op: 'create', path: 'components/Hero.tsx', content: HERO, reason: '' },
  { op: 'create', path: 'lib/rooms.ts', content: ROOMS_LIB, reason: '' },
  { op: 'update', path: 'app/page.tsx', content: HOME, reason: '' },
  { op: 'create', path: 'app/rooms/page.tsx', content: ROOMS_PAGE, reason: '' },
] });

const RATE = { inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000 };
const route = (provider: string, model: string, over: Partial<ModelRoute> = {}): ModelRoute => ({ provider, model, tier: 'balanced', priority: 10, inputCostPerMTokMicros: RATE.inputCostPerMTokMicros, outputCostPerMTokMicros: RATE.outputCostPerMTokMicros, enabled: true, ...over });
const replies = () => [j(SPEC), j(DESIGN), CODE_REPLY];
let free: ScriptedProvider;
let paid: ScriptedProvider;
let router: ProviderRouter;
let app: INestApplication;
let prisma: PrismaClient;
let gen: GenerationsService;
const http = () => request(app.getHttpServer());

function setup(freeReplies: (string | ProviderError)[], paidReplies: string[], routes: ModelRoute[]) {
  free = new ScriptedProvider('free', freeReplies);
  paid = new ScriptedProvider('paid', paidReplies);
  router.setStrategy('margin');
  (router as unknown as { providers: Map<string, unknown> }).providers = new Map([['free', free], ['paid', paid]]);
  router.setRoutes(routes);
  router.setTierRates({ fast: RATE, balanced: RATE, deep: RATE });
}

beforeAll(async () => {
  router = new ProviderRouter([], [], { sleep: async () => {} });
  ({ app, prisma } = await createTestApp({ env: { PLATFORM_OWNER_EMAILS: OWNER_EMAIL }, overrides: [{ provide: AI_ROUTER, useValue: router }] }));
  gen = app.get(GenerationsService);
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma); await prisma.aiTierRate.deleteMany(); await prisma.aiProviderConfig.deleteMany(); });

async function login(label: string, email?: string) {
  const u = newIdentity(label);
  const e = email ?? u.email;
  const auth = `Bearer ${await tokenFor(u.id, e)}`;
  const me = (await http().get(`${V}/me`).set('Authorization', auth).expect(200)).body;
  return { ...u, auth, orgId: me.personalOrgId as string };
}
async function build(a: { auth: string }) {
  const id = (await http().post(`${V}/projects`).set('Authorization', a.auth).send({ name: 'Grand Lake', type: 'website' }).expect(201)).body.id as string;
  const run = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'A site for my lakeside hotel', mode: 'build' }).expect(202);
  await gen.waitFor(run.body.id);
  return (await http().get(`${V}/generations/${run.body.id}`).set('Authorization', a.auth)).body;
}

describe('smart AI routing and credit charging', () => {
  it('serves a build from the free route but charges the customer the standard tier rate', async () => {
    setup(replies(), replies(), [route('free', 'open', { priority: 50, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 }), route('paid', 'big', { priority: 1 }), route('free', 'open-fast', { tier: 'fast', inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 })]);
    const a = await login('buyer');
    const run = await build(a);
    expect(run.status).toBe('succeeded');
    const usage = await prisma.aiUsage.findMany({ where: { organizationId: a.orgId } });
    expect(usage.length).toBeGreaterThan(0);
    const balancedFree = usage.filter((u) => u.provider === 'free');
    expect(balancedFree.length).toBe(usage.length - usage.filter((u) => u.provider === 'paid').length);
    expect(paid.calls.length).toBe(0);
    expect(usage.every((u) => u.costMicros === 0n)).toBe(true); // we paid nothing
    expect(usage.reduce((n, u) => n + u.creditsCharged, 0)).toBe(run.creditsUsed);
    expect(run.creditsUsed).toBeGreaterThan(0); // the customer still paid
  });

  it('charges the same credits no matter which route served the request', async () => {
    const a1 = await login('buyer-free');
    setup(replies(), replies(), [route('free', 'open', { inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 }), route('free', 'f', { tier: 'fast', inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 })]);
    const r1 = await build(a1);
    const a2 = await login('buyer-paid');
    setup(replies(), replies(), [route('paid', 'big'), route('paid', 'bigfast', { tier: 'fast' })]);
    const r2 = await build(a2);
    expect(r1.status).toBe('succeeded');
    expect(r2.status).toBe('succeeded');
    expect(Math.abs(r1.creditsUsed - r2.creditsUsed)).toBeLessThanOrEqual(1);
    const cost = async (org: string) => (await prisma.aiUsage.aggregate({ where: { organizationId: org }, _sum: { costMicros: true } }))._sum.costMicros!;
    expect(await cost(a1.orgId)).toBe(0n);
    expect(await cost(a2.orgId)).toBeGreaterThan(0n);
  });

  it('falls back to the paid route when the free route is rate limited, and the build still succeeds', async () => {
    const limited = Array.from({ length: 8 }, () => new ProviderError('429 slow down', 'free', true, 429));
    setup(limited, replies(), [route('free', 'open', { priority: 1, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 }), route('paid', 'big', { priority: 50 }), route('paid', 'bigfast', { tier: 'fast' })]);
    const a = await login('buyer-429');
    const run = await build(a);
    expect(run.status).toBe('succeeded');
    const usage = await prisma.aiUsage.findMany({ where: { organizationId: a.orgId } });
    expect(usage.some((u) => u.provider === 'free' && !u.success)).toBe(true);
    expect(usage.some((u) => u.provider === 'paid' && u.success)).toBe(true);
  });
});

describe('Owner console: AI routing', () => {
  it('is hidden from customers; staff can read, only superadmin can change; changes apply live and are audited', async () => {
    const customer = await login('cust');
    await http().get(`${V}/admin/ai/routing`).set('Authorization', customer.auth).expect(404);
    const owner = await login('owner', OWNER_EMAIL);
    setup([], [], []);
    await http().put(`${V}/admin/ai/routes`).set('Authorization', customer.auth).send({}).expect(404);

    const body = { provider: 'free', model: 'open-model', tier: 'balanced', priority: 20, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0, quality: 85, dailyRequestLimit: 1000, dailyTokenLimit: null, enabled: true };
    await http().put(`${V}/admin/ai/routes`).set('Authorization', owner.auth).send({ ...body, quality: 101 }).expect(400);
    await http().put(`${V}/admin/ai/routes`).set('Authorization', owner.auth).send({ ...body, provider: 'Bad Name!' }).expect(400);
    const saved = (await http().put(`${V}/admin/ai/routes`).set('Authorization', owner.auth).send(body).expect(200)).body;
    const r = saved.routes.find((x: { model: string }) => x.model === 'open-model');
    expect(r).toMatchObject({ provider: 'free', quality: 85, dailyRequestLimit: 1000, providerConfigured: true, requests24h: 0 });
    expect(router.candidates('balanced').map((x) => x.model)).toContain('open-model'); // live, no restart

    const rates = (await http().put(`${V}/admin/ai/tier-rates/balanced`).set('Authorization', owner.auth).send({ inputCostPerMTokMicros: 3_000_000, outputCostPerMTokMicros: 15_000_000 }).expect(200)).body;
    expect(rates.tierRates.find((t: { tier: string }) => t.tier === 'balanced')).toMatchObject({ outputCostPerMTokMicros: 15_000_000 });
    await http().put(`${V}/admin/ai/tier-rates/ultra`).set('Authorization', owner.auth).send({ inputCostPerMTokMicros: 1, outputCostPerMTokMicros: 1 }).expect(400);

    const overview = (await http().get(`${V}/admin/ai/routing`).set('Authorization', owner.auth).expect(200)).body;
    expect(overview.strategy).toBe('margin');
    expect(overview.providers.find((p: { name: string }) => p.name === 'groq')).toMatchObject({ configured: false });
    await http().delete(`${V}/admin/ai/routes/${r.id}`).set('Authorization', owner.auth).expect(200);
    expect(router.candidates('balanced').map((x) => x.model)).not.toContain('open-model');
    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.ai_route_saved', 'admin.ai_tier_rate_saved', 'admin.ai_route_deleted']));
  });

  it('shows per-route cost, customer revenue and margin from real usage records', async () => {
    const owner = await login('owner2', OWNER_EMAIL);
    const a = await login('payer');
    setup([], [], []);
    await prisma.aiProviderConfig.create({ data: { provider: 'free', model: 'open', tier: 'balanced', inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 } });
    await prisma.aiProviderConfig.create({ data: { provider: 'paid', model: 'big', tier: 'balanced', inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000 } });
    await refreshRouting(router, prisma);
    const row = (provider: string, model: string, costMicros: bigint, credits: number) => ({ organizationId: a.orgId, provider, model, inputTokens: 100, outputTokens: 100, costMicros, creditsCharged: credits, latencyMs: 1, success: true });
    await prisma.aiUsage.createMany({ data: [row('free', 'open', 0n, 50), row('paid', 'big', 200_000n, 50)] });
    const o = (await http().get(`${V}/admin/ai/routing`).set('Authorization', owner.auth).expect(200)).body;
    const f = o.routes.find((x: { provider: string }) => x.provider === 'free');
    const p = o.routes.find((x: { provider: string }) => x.provider === 'paid');
    expect(f.marginUsd24h).toBeCloseTo(0.5, 4); // 50 credits at 100 credits/USD, zero cost
    expect(p.costUsd24h).toBeCloseTo(0.2, 4);
    expect(p.marginUsd24h).toBeCloseTo(0.3, 4);
    expect(o.totals.marginUsd24h).toBeCloseTo(0.8, 4);
  });
});
