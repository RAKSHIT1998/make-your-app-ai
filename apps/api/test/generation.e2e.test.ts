import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider, type AiProvider, type CompletionRequest } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
import { DESIGN, HERO, HOME, ROOMS_LIB, ROOMS_PAGE, SPEC } from './fixtures.js';

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
const router = new ProviderRouter([provider], (['fast', 'balanced', 'deep'] as const).map((tier) => ({ provider: 'scripted', model: `m-${tier}`, tier, priority: 1, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true })), { sleep: async () => {} });

let app: INestApplication;
let prisma: PrismaClient;
let gen: GenerationsService;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ overrides: [{ provide: AI_ROUTER, useValue: router }] }));
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

describe('generation flow', () => {
  it('grants starter credits to new workspaces', async () => {
    const a = await login('a');
    expect((await http().get('/api/v1/credits').set('Authorization', a.auth).expect(200)).body.balance).toBe(200);
  });

  it('prompt → spec → code → validated → committed version, with usage metered and credits debited', async () => {
    const a = await login('a');
    const pid = await newProject(a.auth);
    provider.queue(CREATE_SCRIPT);
    const started = await generate(a.auth, pid, 'A website for my lakeside hotel with rooms');
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ kind: 'create', status: 'queued' });

    const run = (await http().get(`/api/v1/generations/${started.body.id}`).set('Authorization', a.auth).expect(200)).body;
    expect(run.status).toBe('succeeded');
    expect(run.tasks.map((t: { agent: string; status: string }) => `${t.agent}:${t.status}`)).toEqual(['architect:succeeded', 'designer:succeeded', 'frontend:succeeded']);
    expect(run.creditsUsed).toBeGreaterThan(0);

    const project = (await http().get(`/api/v1/projects/${pid}`).set('Authorization', a.auth).expect(200)).body;
    expect(project.status).toBe('ready');
    const versions = (await http().get(`/api/v1/projects/${pid}/versions`).set('Authorization', a.auth).expect(200)).body;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ number: 1, isHead: true });

    const files = (await http().get(`/api/v1/projects/${pid}/files`).set('Authorization', a.auth).expect(200)).body.map((f: { path: string }) => f.path);
    expect(files).toEqual(expect.arrayContaining(['app/layout.tsx', 'app/page.tsx', 'app/rooms/page.tsx', 'components/Hero.tsx', 'package.json']));
    const hero = (await http().get(`/api/v1/projects/${pid}/file?path=components/Hero.tsx`).set('Authorization', a.auth).expect(200)).body;
    expect(hero.content).toBe(HERO);

    const events = (await http().get(`/api/v1/generations/${started.body.id}/events`).set('Authorization', a.auth).expect(200)).body;
    expect(events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['step.started', 'files.changed', 'check.skipped', 'version.committed']));
    const later = (await http().get(`/api/v1/generations/${started.body.id}/events?after=${events[2].id}`).set('Authorization', a.auth).expect(200)).body;
    expect(later).toHaveLength(events.length - 3);

    expect(await prisma.aiUsage.count({ where: { generationRunId: run.id } })).toBe(3);
    const balance = (await http().get('/api/v1/credits').set('Authorization', a.auth)).body.balance;
    expect(balance).toBe(200 - run.creditsUsed);
    const ledger = await prisma.creditLedgerEntry.findMany({ where: { organizationId: a.orgId, reason: 'ai_usage' } });
    expect(ledger.reduce((n, e) => n + e.amount, 0)).toBe(-run.creditsUsed);
  });

  it('edits the existing project, and restores old versions as new versions (undo)', async () => {
    const a = await login('a');
    const pid = await newProject(a.auth);
    provider.queue(CREATE_SCRIPT);
    await generate(a.auth, pid, 'hotel site');
    provider.queue([json({ summary: 'Add penthouse', patches: [{ op: 'update', path: 'lib/rooms.ts', content: ROOMS_LIB.replace('];', "  { name: 'Penthouse', capacity: 2 },\n];"), reason: '' }] })]);
    const edit = await generate(a.auth, pid, 'Add a penthouse room');
    expect(edit.body.kind).toBe('edit');
    expect((await http().get(`/api/v1/generations/${edit.body.id}`).set('Authorization', a.auth)).body.status).toBe('succeeded');
    expect((await http().get(`/api/v1/projects/${pid}/file?path=lib/rooms.ts`).set('Authorization', a.auth)).body.content).toContain('Penthouse');

    const versions = (await http().get(`/api/v1/projects/${pid}/versions`).set('Authorization', a.auth)).body;
    expect(versions.map((v: { number: number }) => v.number)).toEqual([2, 1]);
    const restored = (await http().post(`/api/v1/projects/${pid}/versions/${versions[1].id}/restore`).set('Authorization', a.auth).expect(201)).body;
    expect(restored[0]).toMatchObject({ number: 3, isHead: true });
    expect((await http().get(`/api/v1/projects/${pid}/file?path=lib/rooms.ts`).set('Authorization', a.auth)).body.content).not.toContain('Penthouse');
  });

  it('holds destructive edits for approval; only an admin can apply them', async () => {
    const a = await login('a');
    const member = await login('member');
    await prisma.organizationMembership.create({ data: { organizationId: a.orgId, userId: member.id, role: 'member' } });
    const pid = await newProject(a.auth);
    provider.queue(CREATE_SCRIPT);
    await generate(a.auth, pid, 'hotel site');
    provider.queue([json({ summary: 'Remove rooms page', patches: [{ op: 'delete', path: 'app/rooms/page.tsx', reason: '' }] })]);
    const run = await generate(member.auth, pid, 'remove the rooms page');
    expect((await http().get(`/api/v1/generations/${run.body.id}`).set('Authorization', a.auth)).body.status).toBe('awaiting_approval');
    expect((await http().get(`/api/v1/projects/${pid}/versions`).set('Authorization', a.auth)).body).toHaveLength(1);

    const [approval] = (await http().get(`/api/v1/projects/${pid}/approvals`).set('Authorization', a.auth).expect(200)).body;
    expect(approval).toMatchObject({ action: 'destructive_change', status: 'pending' });
    await http().post(`/api/v1/approvals/${approval.id}/approve`).set('Authorization', member.auth).expect(403);
    expect((await http().post(`/api/v1/approvals/${approval.id}/approve`).set('Authorization', a.auth).expect(201)).body).toEqual({ status: 'applied' });
    await http().post(`/api/v1/approvals/${approval.id}/approve`).set('Authorization', a.auth).expect(409);
    const files = (await http().get(`/api/v1/projects/${pid}/files`).set('Authorization', a.auth)).body.map((f: { path: string }) => f.path);
    expect(files).not.toContain('app/rooms/page.tsx');
    expect((await http().get(`/api/v1/projects/${pid}/versions`).set('Authorization', a.auth)).body).toHaveLength(2);
  });

  it('gives an online store project its own draft store, linked to the project', async () => {
    const a = await login('a');
    const pid = await newProject(a.auth, 'ecommerce');
    const stores = (await http().get('/api/v1/stores').set('Authorization', a.auth).expect(200)).body as { projectId: string; status: string; currency: string }[];
    expect(stores.filter((s) => s.projectId === pid)).toEqual([expect.objectContaining({ status: 'draft', currency: 'INR' })]);
  });

  it('allows only one active run per project', async () => {
    const a = await login('a');
    const pid = await newProject(a.auth);
    let release!: () => void;
    provider.gate = new Promise((r) => (release = r));
    provider.queue(CREATE_SCRIPT);
    const first = await http().post(`/api/v1/projects/${pid}/generations`).set('Authorization', a.auth).send({ prompt: 'hotel site' }).expect(202);
    const second = await http().post(`/api/v1/projects/${pid}/generations`).set('Authorization', a.auth).send({ prompt: 'again' }).expect(409);
    expect(second.body.runId).toBe(first.body.id);
    release();
    await gen.waitFor(first.body.id);
  });

  it('enforces credit limits before and during runs', async () => {
    const a = await login('a');
    const pid = await newProject(a.auth);
    await prisma.creditLedgerEntry.create({ data: { organizationId: a.orgId, amount: -198, reason: 'adjustment', idempotencyKey: 'test-drain' } });
    expect((await generate(a.auth, pid, 'hotel site')).status).toBe(402);

    await prisma.creditLedgerEntry.create({ data: { organizationId: a.orgId, amount: 20, reason: 'adjustment', idempotencyKey: 'test-topup' } });
    provider.queue(CREATE_SCRIPT);
    const run = await generate(a.auth, pid, 'hotel site');
    expect(run.status).toBe(202);
    const done = (await http().get(`/api/v1/generations/${run.body.id}`).set('Authorization', a.auth)).body;
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/Not enough credits/);
    expect((await http().get('/api/v1/credits').set('Authorization', a.auth)).body.balance).toBeGreaterThanOrEqual(0);
  });

  it('keeps runs, events, files and versions private to the owning org', async () => {
    const a = await login('a');
    const b = await login('b');
    const pid = await newProject(a.auth);
    provider.queue(CREATE_SCRIPT);
    const run = await generate(a.auth, pid, 'hotel site');
    for (const url of [`/api/v1/generations/${run.body.id}`, `/api/v1/generations/${run.body.id}/events`, `/api/v1/projects/${pid}/files`, `/api/v1/projects/${pid}/file?path=app/page.tsx`, `/api/v1/projects/${pid}/versions`, `/api/v1/projects/${pid}/approvals`]) {
      await http().get(url).set('Authorization', b.auth).expect(404);
    }
    await http().post(`/api/v1/projects/${pid}/generations`).set('Authorization', b.auth).send({ prompt: 'hijack' }).expect(404);
  });

  it('reports workspace activity, credit estimates and usage history from real records', async () => {
    const a = await login('a');
    const pid = await newProject(a.auth);
    provider.queue(CREATE_SCRIPT);
    const run = await generate(a.auth, pid, 'hotel site');
    const activity = (await http().get('/api/v1/activity').set('Authorization', a.auth).expect(200)).body;
    expect(activity[0]).toMatchObject({ id: run.body.id, status: 'succeeded', project: { id: pid, name: 'Grand Lake' } });
    const est = (await http().get('/api/v1/generations/estimate').set('Authorization', a.auth).expect(200)).body;
    expect(est).toMatchObject({ maxCreditsPerRun: 500, typical: { create: null, edit: null } });
    expect(est.balance).toBe(200 - activity[0].creditsUsed);
    const usage = (await http().get('/api/v1/billing/usage').set('Authorization', a.auth).expect(200)).body;
    expect(usage.filter((u: { reason: string }) => u.reason === 'ai_usage').length).toBeGreaterThan(0);
    expect(usage.find((u: { reason: string }) => u.reason === 'ai_usage').detail).toContain('Grand Lake');
    const b = await login('b');
    await http().get(`/api/v1/activity?organizationId=${a.orgId}`).set('Authorization', b.auth).expect(404);
    await http().get(`/api/v1/billing/usage?organizationId=${a.orgId}`).set('Authorization', b.auth).expect(404);
  });

  it('streams events over SSE until the run finishes', async () => {
    const a = await login('a');
    const pid = await newProject(a.auth);
    provider.queue(CREATE_SCRIPT);
    const run = await generate(a.auth, pid, 'hotel site');
    const res = await http().get(`/api/v1/generations/${run.body.id}/stream`).set('Authorization', a.auth).expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: agent-event');
    expect(res.text).toContain('event: run');
    expect(res.text).toContain('"status":"succeeded"');
  });
});
