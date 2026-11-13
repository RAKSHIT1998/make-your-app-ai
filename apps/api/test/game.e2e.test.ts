import request from 'supertest';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider, type AiProvider, type CompletionRequest } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
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

describe('Games and browser apps', () => {
  it('generates a game, runs it through the same checks as any project, and serves a sandbox-ready preview', async () => {
    const a = await login('gamer');
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const { id, run } = await build(a.auth, 'A neon breakout game with levels and a saved high score');
    expect(run.status).toBe('succeeded');
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).templateId).toBe('web-play@1');
    const files = (await http().get(`${V}/projects/${id}/files`).set('Authorization', a.auth)).body.map((f: { path: string }) => f.path);
    expect(files).toEqual(expect.arrayContaining(['index.html', 'style.css', 'app.js']));

    const p = (await http().get(`${V}/projects/${id}/preview`).set('Authorization', a.auth).expect(200)).body;
    expect(p.html).toContain('Content-Security-Policy');
    expect(p.html).toContain("connect-src 'none'");
    expect(p.html).toContain('requestAnimationFrame'); // script inlined
    expect(p.html).not.toContain('src="app.js"');
    expect(p.warnings).toEqual([]);
  });

  it('repairs a game whose first draft does not compile or loads from the network', async () => {
    const a = await login('gamer2');
    const bad = JSON.stringify({ summary: 'Draft', patches: patches({ ...GAME, 'app.js': 'function (', 'index.html': GAME['index.html'].replace('</body>', '<script src="https://cdn.example.com/p.js"></script></body>') }) });
    const fix = JSON.stringify({ diagnosis: 'Fixed the syntax error and removed the CDN script.', patches: patches(GAME) });
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), bad, fix]);
    const { id, run } = await build(a.auth, 'A breakout game');
    expect(run.status).toBe('succeeded');
    const events = (await http().get(`${V}/generations/${run.id}/events?after=0`).set('Authorization', a.auth)).body as { type: string; message: string }[];
    expect(events.some((e) => e.type === 'check.failed')).toBe(true);
    const html = (await http().get(`${V}/projects/${id}/file?path=index.html`).set('Authorization', a.auth)).body.content as string;
    expect(html).not.toContain('cdn.example.com');
  });

  it('fails honestly when the draft cannot be repaired, and never commits it', async () => {
    const a = await login('gamer3');
    const bad = JSON.stringify({ summary: 'Draft', patches: patches({ ...GAME, 'app.js': 'function (' }) });
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), bad, JSON.stringify({ diagnosis: 'x', patches: patches({ 'app.js': 'let (' }) }), JSON.stringify({ diagnosis: 'y', patches: patches({ 'app.js': 'let (' }) })]);
    const { id, run } = await build(a.auth, 'A broken game');
    expect(run.status).toBe('failed');
    expect(run.error).toContain('Syntax error');
    const versions = (await http().get(`${V}/projects/${id}/versions`).set('Authorization', a.auth)).body;
    expect(versions).toHaveLength(0);
  });

  it('only previews static projects, and only for members of the workspace', async () => {
    const a = await login('gamer4');
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const { id } = await build(a.auth, 'A breakout game');
    const b = await login('snoop');
    await http().get(`${V}/projects/${id}/preview`).set('Authorization', b.auth).expect(404);
    await http().get(`${V}/projects/${id}/preview`).expect(401);
    const site = (await http().post(`${V}/projects`).set('Authorization', a.auth).send({ name: 'Site', type: 'website' }).expect(201)).body.id;
    await http().get(`${V}/projects/${site}/preview`).set('Authorization', a.auth).expect(422);
  });

  it('browser apps (custom_software) use the same template', async () => {
    const a = await login('toolmaker');
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
    const { run } = await build(a.auth, 'A budget planner', 'custom_software');
    expect(run.status).toBe('succeeded');
    expect((await prisma.project.findFirstOrThrow({ where: { type: 'custom_software' } })).templateId).toBe('web-play@1');
  });
});
