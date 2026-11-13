import request from 'supertest';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider, type AiProvider, type CompletionRequest } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { FlagsService } from '../src/flags/flags.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
import { DESIGN, SPEC } from './fixtures.js';
const V = '/api/v1';

const fx = (f: string) => readFileSync(new URL(`../../../packages/codegen/test/fixtures/${f}`, import.meta.url), 'utf8');
const GAME = { 'index.html': fx('breakout-index.html'), 'style.css': fx('breakout-style.css'), 'app.js': fx('breakout-app.js') };
const patches = (files: Record<string, string>) => Object.entries(files).map(([path, content]) => ({ op: 'update', path, content, reason: '' }));
const GOOD = JSON.stringify({ summary: 'Neon Breakout', patches: patches(GAME) });

class QueueProvider implements AiProvider {
  readonly name = 'scripted';
  inner = new ScriptedProvider('scripted', []);
  queue(replies: string[]) { this.inner = new ScriptedProvider('scripted', [...replies]); }
  capabilities() { return { structuredOutput: true, maxOutputTokens: 64_000 }; }
  async complete(model: string, req: CompletionRequest) { return this.inner.complete(model, req); }
}
const provider = new QueueProvider();
const router = new ProviderRouter([provider], (['fast', 'balanced', 'deep'] as const).map((tier) => ({ provider: 'scripted', model: `m-${tier}`, tier, priority: 1, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true })));

let app: INestApplication;
let prisma: PrismaClient;
let gen: GenerationsService;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ overrides: [{ provide: AI_ROUTER, useValue: router }] }));
  gen = app.get(GenerationsService);
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma); });

async function login(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { ...u, auth };
}
async function build(auth: string, prompt: string, type = 'game') {
  const id = (await http().post(`${V}/projects`).set('Authorization', auth).send({ name: 'Neon Breakout', type }).expect(201)).body.id as string;
  const run = await http().post(`${V}/projects/${id}/generations`).set('Authorization', auth).send({ prompt, mode: 'build' });
  expect(run.status, JSON.stringify(run.body)).toBe(202);
  await gen.waitFor(run.body.id);
  const done = (await http().get(`${V}/generations/${run.body.id}`).set('Authorization', auth)).body;
  return { id, run: done };
}


const BAD = [JSON.stringify(SPEC), JSON.stringify(DESIGN), JSON.stringify({ summary: 'Draft', patches: patches({ ...GAME, 'app.js': 'function (' }) }), JSON.stringify({ diagnosis: 'x', patches: patches({ 'app.js': 'let (' }) }), JSON.stringify({ diagnosis: 'y', patches: patches({ 'app.js': 'let (' }) })];
const balance = async (auth: string) => {
  const me = (await http().get(`${V}/me`).set('Authorization', auth).expect(200)).body;
  const m = await prisma.organizationMembership.findFirstOrThrow({ where: { userId: me.id } });
  return (await prisma.creditLedgerEntry.aggregate({ where: { organizationId: m.organizationId }, _sum: { amount: true } }))._sum.amount ?? 0;
};
const orgOf = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).organizationId;

describe('failed-build guarantee', () => {
  it('returns every credit of a run that fails, exactly once, to the bucket it came from', async () => {
    const a = await login('fair1');
    const before = await balance(a.auth);
    provider.queue(BAD);
    const { id, run } = await build(a.auth, 'A broken game');
    expect(run.status).toBe('failed');
    expect(run.creditsUsed).toBeGreaterThan(0);
    expect(run.creditsRefunded).toBe(run.creditsUsed);
    expect(await balance(a.auth)).toBe(before);
    const events = (await http().get(`${V}/generations/${run.id}/events`).set('Authorization', a.auth)).body;
    expect(events.some((e: { type: string; message: string }) => e.type === 'run.refunded' && e.message.includes(String(run.creditsUsed)))).toBe(true);
    // Idempotent: asking again refunds nothing more.
    expect(await gen.refundFailedRun(run.id, await orgOf(id))).toBe(0);
    expect(await balance(a.auth)).toBe(before);
    const ledger = await prisma.creditLedgerEntry.findMany({ where: { reason: 'refund', referenceId: run.id } });
    expect(ledger.reduce((n, l) => n + l.amount, 0)).toBe(run.creditsUsed);
    expect(ledger.every((l) => l.bucket === 'allowance')).toBe(true);
  });

  it('successful runs stay charged, and so do runs stopped by the customer’s own credit limit', async () => {
    const a = await login('fair2');
    const before = await balance(a.auth);
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const ok = await build(a.auth, 'A neon breakout game');
    expect(ok.run.status).toBe('succeeded');
    expect(ok.run.creditsRefunded).toBe(0);
    const afterOk = await balance(a.auth);
    expect(afterOk).toBe(before - ok.run.creditsUsed);

    await prisma.subscriptionEntitlement.update({ where: { organizationId: await orgOf(ok.id) }, data: { maxCreditsPerRun: 3 } });
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const capped = await build(a.auth, 'Another game');
    expect(capped.run.status).toBe('failed');
    expect(capped.run.error).toMatch(/limit of 3 credits/);
    expect(capped.run.creditsRefunded).toBe(0);
    expect(await balance(a.auth)).toBe(afterOk - capped.run.creditsUsed);
  });

  it('stops refunding after the daily cap, and the owner can switch the guarantee off', async () => {
    const a = await login('fair3');
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      provider.queue(BAD);
      const { run } = await build(a.auth, `Broken ${i}`);
      results.push(run.creditsRefunded);
      if (i === 5) {
        const events = (await http().get(`${V}/generations/${run.id}/events`).set('Authorization', a.auth)).body;
        expect(events.some((e: { type: string }) => e.type === 'run.refund_skipped')).toBe(true);
      }
    }
    expect(results.slice(0, 5).every((n) => n > 0)).toBe(true);
    expect(results[5]).toBe(0);

    const b = await login('fair4');
    await prisma.platformFlag.create({ data: { key: 'refund_failed_builds', enabled: false, description: 'off' } });
    (app.get(FlagsService) as unknown as { cache: unknown }).cache = null;
    provider.queue(BAD);
    const off = await build(b.auth, 'Broken with the guarantee off');
    expect(off.run.status).toBe('failed');
    expect(off.run.creditsRefunded).toBe(0);
    (app.get(FlagsService) as unknown as { cache: unknown }).cache = null;
  });
});

describe('Ask mode', () => {
  it('answers from the project’s files on the fast tier, changes no code, and is charged like any AI call', async () => {
    const a = await login('ask1');
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const { id } = await build(a.auth, 'A neon breakout game');
    const versions = (await http().get(`${V}/projects/${id}/versions`).set('Authorization', a.auth)).body.length;
    const before = await balance(a.auth);

    let seen = '';
    provider.queue([JSON.stringify({ answer: 'The ball speeds up each level in app.js.', suggestedPrompt: 'Make the ball 20% slower on level 1' })]);
    const orig = provider.inner.complete.bind(provider.inner);
    provider.inner.complete = async (model, req) => { seen = `${model}|${JSON.stringify(req)}`; return orig(model, req); };
    const r = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'Why is the ball so fast?', mode: 'ask' }).expect(202);
    expect(r.body.kind).toBe('ask');
    await gen.waitFor(r.body.id);
    const done = (await http().get(`${V}/generations/${r.body.id}`).set('Authorization', a.auth)).body;
    expect(done.status).toBe('succeeded');
    expect(done.answer).toBe('The ball speeds up each level in app.js.');
    expect(done.plan).toEqual({ suggestedPrompt: 'Make the ball 20% slower on level 1' });
    expect(seen.startsWith('m-fast|')).toBe(true);
    expect(seen).toContain('requestAnimationFrame'); // the real files were in context
    expect(done.creditsUsed).toBeGreaterThan(0);
    expect(await balance(a.auth)).toBe(before - done.creditsUsed);

    expect((await http().get(`${V}/projects/${id}/versions`).set('Authorization', a.auth)).body).toHaveLength(versions);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).status).toBe('ready');
  });

  it('is private to the workspace, and a failed answer is refunded without marking the project broken', async () => {
    const a = await login('ask2');
    const b = await login('ask3');
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const { id } = await build(a.auth, 'A neon breakout game');
    await http().post(`${V}/projects/${id}/generations`).set('Authorization', b.auth).send({ prompt: 'What is in here?', mode: 'ask' }).expect(404);

    const before = await balance(a.auth);
    provider.queue(['not json', 'still not json', 'nope']);
    const r = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'Explain the scoring', mode: 'ask' }).expect(202);
    await gen.waitFor(r.body.id);
    const done = (await http().get(`${V}/generations/${r.body.id}`).set('Authorization', a.auth)).body;
    expect(done.status).toBe('failed');
    expect(done.answer).toBeNull();
    expect(await balance(a.auth)).toBe(before);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).status).toBe('ready');
    await http().get(`${V}/generations/${r.body.id}`).set('Authorization', b.auth).expect(404);
  });
});

describe('playable public pages', () => {
  it('serves the published version of a game to anyone, sandbox-ready, and never later private edits', async () => {
    const a = await login('play1');
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const { id } = await build(a.auth, 'A neon breakout game');
    await http().get(`${V}/showcase/neon-breakout/play`).expect(404); // not published yet
    const pub = (await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'public', publicTitle: 'Neon Breakout', publicDescription: 'Break all the bricks', category: 'other' }).expect(200)).body;
    const slug = pub.slug as string;

    const page = (await http().get(`${V}/showcase/${slug}`).expect(200)).body;
    expect(page.playable).toBe(true);
    const play = (await http().get(`${V}/showcase/${slug}/play`).expect(200)).body; // no token
    expect(play.html).toContain("connect-src 'none'");
    expect(play.html).toContain('requestAnimationFrame');
    expect(play.versionNumber).toBe(1);

    // A later private edit is not what visitors run until the owner publishes again.
    provider.queue([JSON.stringify({ summary: 'Secret tweak', patches: patches({ 'app.js': `${GAME['app.js']}\n// PRIVATE_DRAFT_MARKER` }) })]);
    const edit = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'tweak', mode: 'build' }).expect(202);
    await gen.waitFor(edit.body.id);
    expect((await http().get(`${V}/projects/${id}/preview`).set('Authorization', a.auth)).body.html).toContain('PRIVATE_DRAFT_MARKER');
    expect((await http().get(`${V}/showcase/${slug}/play`).expect(200)).body.html).not.toContain('PRIVATE_DRAFT_MARKER');

    // Unpublishing takes the player down with the page.
    await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'private' }).expect(200);
    await http().get(`${V}/showcase/${slug}/play`).expect(404);
  });
});
