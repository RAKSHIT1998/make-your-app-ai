import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider, type AiProvider, type CompletionRequest } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
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



const PLAN = (questions = [{ id: 'audience', question: 'Who are your main guests?', why: 'Changes tone and pages' }]) =>
  JSON.stringify({ spec: SPEC, questions, assumptions: ['Prices shown on request'] });
const CODE_ONLY = [JSON.stringify(DESIGN), CODE];

async function admin(label: string) {
  const u = await login(label);
  await prisma.user.update({ where: { id: u.id }, data: { platformRole: 'admin' } });
  return u;
}

describe('plan-first builder', () => {
  it('drafts a plan with questions and writes no code; building from it skips re-planning', async () => {
    const a = await login('planner');
    const id = await newProject(a.auth);
    provider.queue([PLAN()]);
    const plan = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'A boutique lakeside hotel', mode: 'plan' }).expect(202);
    await gen.waitFor(plan.body.id);
    const runs = (await http().get(`${V}/projects/${id}/generations`).set('Authorization', a.auth)).body;
    expect(runs[0]).toMatchObject({ kind: 'plan', status: 'succeeded' });
    expect(runs[0].plan.questions[0].id).toBe('audience');
    expect(runs[0].creditsUsed).toBeGreaterThan(0); // planning is metered like any AI work
    expect((await http().get(`${V}/projects/${id}/files`).set('Authorization', a.auth)).body).toHaveLength(0);
    expect((await http().get(`${V}/projects/${id}`).set('Authorization', a.auth)).body.status).toBe('draft');

    provider.queue(CODE_ONLY); // designer + frontend only: the architect is not called again
    const build = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'A boutique lakeside hotel', planRunId: plan.body.id }).expect(202);
    await gen.waitFor(build.body.id);
    const after = (await http().get(`${V}/projects/${id}/generations`).set('Authorization', a.auth)).body;
    expect(after[0]).toMatchObject({ kind: 'create', status: 'succeeded', fromPlanId: plan.body.id });
    const events = (await http().get(`${V}/generations/${build.body.id}/events`).set('Authorization', a.auth)).body;
    expect(events.some((e: { message: string }) => e.message.startsWith('Using your approved plan'))).toBe(true);
    // Once there's code, plans are refused.
    await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'again', mode: 'plan' }).expect(400);
  });

  it('answers revise the plan before code; plans from other projects are rejected', async () => {
    const a = await login('answers');
    const id = await newProject(a.auth);
    provider.queue([PLAN()]);
    const plan = (await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'Hotel site', mode: 'plan' }).expect(202)).body;
    await gen.waitFor(plan.id);
    const other = await newProject(a.auth);
    await http().post(`${V}/projects/${other}/generations`).set('Authorization', a.auth).send({ prompt: 'Hotel', planRunId: plan.id }).expect(404);
    const b = await login('stranger');
    await http().post(`${V}/projects/${id}/generations`).set('Authorization', b.auth).send({ prompt: 'Hotel', planRunId: plan.id }).expect(404);

    provider.queue([JSON.stringify(SPEC), ...CODE_ONLY]); // architect revises with answers, then design + code
    const build = (await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'Hotel site', planRunId: plan.id, answers: 'Mostly couples on weekends' }).expect(202)).body;
    await gen.waitFor(build.id);
    const events = (await http().get(`${V}/generations/${build.id}/events`).set('Authorization', a.auth)).body;
    expect(events.some((e: { message: string }) => e.message === 'Updating the plan with your answers')).toBe(true);
    expect((await http().get(`${V}/generations/${build.id}`).set('Authorization', a.auth)).body.status).toBe('succeeded');
  });
});

describe('feature flags', () => {
  it('owners switch features off server-side; clients can read flags publicly', async () => {
    const owner = await admin('flag-owner');
    const user = await login('flag-user');
    expect((await http().get(`${V}/flags`).expect(200)).body).toMatchObject({ ai_generation: true, remix: true });
    await http().patch(`${V}/admin/flags/ai_generation`).set('Authorization', user.auth).send({ enabled: false }).expect(404);
    await http().patch(`${V}/admin/flags/not_a_flag`).set('Authorization', owner.auth).send({ enabled: false }).expect(400);
    await http().patch(`${V}/admin/flags/ai_generation`).set('Authorization', owner.auth).send({ enabled: false }).expect(200);
    const id = await newProject(user.auth);
    const r = await http().post(`${V}/projects/${id}/generations`).set('Authorization', user.auth).send({ prompt: 'Anything at all' }).expect(503);
    expect(r.body.code).toBe('feature_disabled');
    await http().patch(`${V}/admin/flags/explore`).set('Authorization', owner.auth).send({ enabled: false }).expect(200);
    await new Promise((res) => setTimeout(res, 5100)); // flags are cached briefly
    await http().get(`${V}/explore`).expect(503);
    await http().patch(`${V}/admin/flags/ai_generation`).set('Authorization', owner.auth).send({ enabled: true }).expect(200);
    await http().patch(`${V}/admin/flags/explore`).set('Authorization', owner.auth).send({ enabled: true }).expect(200);
    const list = (await http().get(`${V}/admin/flags`).set('Authorization', owner.auth).expect(200)).body;
    expect(list.find((f: { key: string }) => f.key === 'explore')).toMatchObject({ enabled: true, description: expect.any(String) });
    expect((await prisma.auditLog.count({ where: { action: 'admin.flag_changed' } }))).toBe(4);
  }, 20_000);
});

describe('retention: achievements, streaks, timeline', () => {
  it('awards badges only from real activity and builds a timeline', async () => {
    const a = await login('achiever');
    let ach = (await http().get(`${V}/me/achievements`).set('Authorization', a.auth).expect(200)).body;
    expect(ach.badges.every((b: { earnedAt: string | null }) => b.earnedAt === null)).toBe(true);
    expect(ach.streak).toMatchObject({ current: 0, longest: 0 });

    const id = await newProject(a.auth);
    ach = (await http().get(`${V}/me/achievements`).set('Authorization', a.auth)).body;
    expect(ach.badges.find((b: { key: string }) => b.key === 'first_project').earnedAt).not.toBeNull();
    expect(ach.badges.find((b: { key: string }) => b.key === 'first_build').earnedAt).toBeNull();

    provider.queue(CREATE_SCRIPT);
    await generate(a.auth, id, 'A boutique lakeside hotel');
    await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'public' }).expect(200);
    ach = (await http().get(`${V}/me/achievements`).set('Authorization', a.auth)).body;
    const earned = ach.badges.filter((b: { earnedAt: string | null }) => b.earnedAt).map((b: { key: string }) => b.key);
    expect(earned).toEqual(['first_project', 'first_build', 'first_publish']);
    expect(ach.streak.current).toBe(1);
    expect(ach.streak.last30.at(-1)).toBe(true);

    const tl = (await http().get(`${V}/timeline`).set('Authorization', a.auth).expect(200)).body;
    expect(tl.map((t: { action: string }) => t.action)).toEqual(['project.published', 'generation.started', 'project.created']);
    expect(tl[1].detail).toMatchObject({ status: 'succeeded' });
    expect(tl[0].project.id).toBe(id);
    // Another user's workspace timeline is off limits.
    const b = await login('nosy');
    await http().get(`${V}/timeline?organizationId=${a.orgId}`).set('Authorization', b.auth).expect(404);
  });
});
