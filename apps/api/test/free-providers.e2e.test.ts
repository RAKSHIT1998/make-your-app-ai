import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { DISCOVERY_FETCH } from '../src/admin/ai-routing.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
const V = '/api/v1';
const OWNER = 'owner-free@example.com';

/** Emulated provider model lists (the test environment has no internet). The discovery and parsing code is real. */
const listed: string[] = [];
const discoveryFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  listed.push(u);
  const auth = (init?.headers as Record<string, string>)?.authorization;
  if (u === 'https://api.groq.com/openai/v1/models') return Response.json({ data: [{ id: 'openai/gpt-oss-120b', active: true, context_window: 131072 }, { id: 'whisper-large-v3', active: true }] });
  if (u === 'https://openrouter.ai/api/v1/models') return auth === 'Bearer or-bad' ? new Response('{}', { status: 401 }) : Response.json({ data: [{ id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } }, { id: 'openai/gpt-5', pricing: { prompt: '0.000001', completion: '0.00001' } }] });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const groq = new ScriptedProvider('groq', []);
const router = new ProviderRouter([groq], []);
let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ env: { PLATFORM_OWNER_EMAILS: OWNER, GROQ_API_KEY: 'gsk-test-secret', OPENROUTER_API_KEY: 'or-bad' }, overrides: [{ provide: AI_ROUTER, useValue: router }, { provide: DISCOVERY_FETCH, useValue: discoveryFetch }] }));
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma); await prisma.aiProviderConfig.deleteMany(); listed.length = 0; });

async function login(label: string, email?: string) {
  const u = newIdentity(label);
  const mail = email ?? u.email;
  const auth = `Bearer ${await tokenFor(u.id, mail)}`;
  await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { auth };
}

describe('free AI providers', () => {
  it('lists every free provider, discovers live free models only where a key is set, and never exposes keys', async () => {
    const owner = await login('o', OWNER);
    await http().put(`${V}/admin/ai/routes`).set('Authorization', owner.auth).send({ provider: 'groq', model: 'openai/gpt-oss-120b', tier: 'fast', inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0, quality: 60 }).expect(200);
    const list = (await http().get(`${V}/admin/ai/free-providers`).set('Authorization', owner.auth).expect(200)).body as { key: string; configured: boolean; models: { id: string; route: unknown }[]; error: string | null; freeTier: string }[];
    expect(list.map((p) => p.key)).toEqual(['groq', 'cerebras', 'openrouter', 'gemini', 'cloudflare']);
    const g = list.find((p) => p.key === 'groq')!;
    expect(g.configured).toBe(true);
    expect(g.models).toEqual([{ id: 'openai/gpt-oss-120b', pricing: 'free_tier', contextWindow: 131072, route: { tier: 'fast', enabled: true } }]);
    expect(list.find((p) => p.key === 'openrouter')!.error).toBe('The provider rejected the API key.');
    const c = list.find((p) => p.key === 'cerebras')!;
    expect(c).toMatchObject({ configured: false, models: [], error: null });
    expect(listed.some((u) => u.includes('cerebras'))).toBe(false); // no key → no call
    expect(JSON.stringify(list)).not.toContain('gsk-test-secret');
    expect(JSON.stringify(list)).not.toContain('or-bad');

    // Cached: a second read makes no provider calls; refresh=1 does.
    const groqCalls = () => listed.filter((u) => u.includes('groq')).length;
    await http().get(`${V}/admin/ai/free-providers`).set('Authorization', owner.auth).expect(200);
    expect(groqCalls()).toBe(1); // cached
    await http().get(`${V}/admin/ai/free-providers?refresh=1`).set('Authorization', owner.auth).expect(200);
    expect(groqCalls()).toBe(2);
  });

  it('tests a route with one real call, owner-only and audited', async () => {
    const owner = await login('o2', OWNER);
    const customer = await login('c');
    await http().get(`${V}/admin/ai/free-providers`).set('Authorization', customer.auth).expect(404);
    await http().post(`${V}/admin/ai/routes/test`).set('Authorization', customer.auth).send({ provider: 'groq', model: 'm' }).expect(404);

    (groq as unknown as { replies: string[] }).replies = ['{"sum": 5}'];
    expect((await http().post(`${V}/admin/ai/routes/test`).set('Authorization', owner.auth).send({ provider: 'groq', model: 'openai/gpt-oss-120b' }).expect(200)).body).toMatchObject({ ok: true, error: null });
    (groq as unknown as { replies: string[] }).replies = ['I think it is five'];
    expect((await http().post(`${V}/admin/ai/routes/test`).set('Authorization', owner.auth).send({ provider: 'groq', model: 'openai/gpt-oss-120b' }).expect(200)).body.ok).toBe(false);
    expect((await http().post(`${V}/admin/ai/routes/test`).set('Authorization', owner.auth).send({ provider: 'cerebras', model: 'x' }).expect(200)).body.error).toMatch(/No API key/);
    expect(await prisma.auditLog.count({ where: { action: 'admin.ai_route_tested' } })).toBe(3);
    expect(await prisma.aiUsage.count()).toBe(0); // probes are never billed to anyone
  });
});
