import request from 'supertest';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider, type AiProvider, type CompletionRequest } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { FlagsService } from '../src/flags/flags.service.js';
import { SERVICES_FETCH } from '../src/appdata/app-services.service.js';

/** Emulated Frankfurter API (no internet in tests); the platform code calling it is real. */
const upstream: string[] = [];
let ratesDown = false;
const servicesFetch = (async (url: string | URL | Request) => {
  const u = new URL(String(url));
  upstream.push(u.toString());
  if (ratesDown) throw new TypeError('fetch failed');
  if (u.host !== 'api.frankfurter.dev' || u.pathname !== '/v1/latest') return new Response('{}', { status: 404 });
  const base = u.searchParams.get('base');
  if (base === 'XXX') return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
  return Response.json({ amount: 1, base, date: '2026-11-13', rates: base === 'USD' ? { EUR: 0.86, INR: 88.4, GBP: 0.76 } : { USD: 1.16, INR: 102.8 } });
}) as typeof fetch;
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
import { DESIGN, SPEC } from './fixtures.js';
const V = '/api/v1';

const fx = (f: string) => readFileSync(new URL(`../../../packages/codegen/test/fixtures/${f}`, import.meta.url), 'utf8');
const TASKS: Record<string, string> = { 'index.html': fx('tasks-index.html'), 'style.css': fx('tasks-style.css'), 'app.js': fx('tasks-app.js'), 'app.backend.json': fx('tasks-backend.json') };
const patches = (files: Record<string, string>) => Object.entries(files).map(([path, content]) => ({ op: 'update', path, content, reason: '' }));
const GOOD = JSON.stringify({ summary: 'Taskly: sign-up, sign-in and private task lists', patches: patches(TASKS) });

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
  ({ app, prisma } = await createTestApp({ env: { APP_DATA_RATE_LIMIT_PER_MINUTE: '100000', APP_AUTH_RATE_LIMIT_PER_MINUTE: '100000', APP_DATA_MAX_RECORDS: '25' }, overrides: [{ provide: SERVICES_FETCH, useValue: servicesFetch }, { provide: AI_ROUTER, useValue: router }] }));
  gen = app.get(GenerationsService);
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma, { projectTypes: ['saas', 'game'] }); });

async function login(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { ...u, auth };
}
async function build(auth: string, prompt: string, type = 'saas') {
  const id = (await http().post(`${V}/projects`).set('Authorization', auth).send({ name: 'Taskly', type }).expect(201)).body.id as string;
  const run = await http().post(`${V}/projects/${id}/generations`).set('Authorization', auth).send({ prompt, mode: 'build' });
  expect(run.status, JSON.stringify(run.body)).toBe(202);
  await gen.waitFor(run.body.id);
  const done = (await http().get(`${V}/generations/${run.body.id}`).set('Authorization', auth)).body;
  return { id, run: done };
}


const keyOf = (html: string) => /\/api\/v1\/appdata\/(pv_[A-Za-z0-9_-]+|lv_[0-9a-f-]+)/.exec(html)![1]!;
async function fullstack(label: string) {
  const a = await login(label);
  provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), GOOD]);
  const { id, run } = await build(a.auth, 'A task app with accounts');
  expect(run.status, run.error).toBe('succeeded');
  const preview = (await http().get(`${V}/projects/${id}/preview`).set('Authorization', a.auth).expect(200)).body;
  const base = `${V}/appdata/${keyOf(preview.html)}`;
  return { a, id, preview, base };
}
const signUp = async (base: string, email: string) => (await http().post(`${base}/auth/signup`).send({ email, password: 'correct horse 1' }).expect(201)).body as { token: string; user: { id: string; email: string } };

describe('full-stack apps: built-in backend', () => {
  it('builds an app whose preview carries the SDK and may reach only its own data endpoint', async () => {
    const { preview } = await fullstack('fs1');
    expect(preview.backend).toBe(true);
    expect(preview.html).toContain('window.__APP_BACKEND__=');
    expect(preview.html).toContain('"env":"preview"');
    expect(preview.html).toMatch(/connect-src http:\/\/localhost:4000[;"]/);
    expect(preview.html).not.toContain("connect-src 'none'");
    expect(preview.html.indexOf('window.App = Object.freeze')).toBeLessThan(preview.html.indexOf('App.auth.onChange'));
  });

  it('signs end users up and in, keeps each user’s private records private, and validates every write', async () => {
    const { base } = await fullstack('fs2');
    const ann = await signUp(base, 'Ann@Example.com');
    expect(ann.user.email).toBe('ann@example.com');
    expect(ann.token).toMatch(/^ast_/);
    await http().post(`${base}/auth/signup`).send({ email: 'ann@example.com', password: 'another pass' }).expect(409);
    await http().post(`${base}/auth/signup`).send({ email: 'x@example.com', password: 'short' }).expect(400);
    const wrong = await http().post(`${base}/auth/signin`).send({ email: 'ann@example.com', password: 'wrong password' }).expect(401);
    const unknown = await http().post(`${base}/auth/signin`).send({ email: 'nobody@example.com', password: 'wrong password' }).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message); // no account enumeration
    const again = (await http().post(`${base}/auth/signin`).send({ email: 'ANN@example.com', password: 'correct horse 1' }).expect(200)).body;
    expect((await http().get(`${base}/auth/me`).set('x-app-session', again.token).expect(200)).body.user.email).toBe('ann@example.com');

    const stored = await prisma.appUser.findFirstOrThrow({ where: { email: 'ann@example.com' } });
    expect(stored.passwordHash).toMatch(/^scrypt\$/);
    expect(stored.passwordHash).not.toContain('correct horse');

    await http().post(`${base}/c/tasks`).send({ title: 'anon' }).expect(401);
    const t = (await http().post(`${base}/c/tasks`).set('x-app-session', ann.token).send({ title: 'Buy milk', priority: 'high' }).expect(201)).body;
    expect(t).toMatchObject({ title: 'Buy milk', priority: 'high', mine: true });
    await http().post(`${base}/c/tasks`).set('x-app-session', ann.token).send({ priority: 'high' }).expect(400);
    expect((await http().post(`${base}/c/tasks`).set('x-app-session', ann.token).send({ title: 'x', owner: 'me' }).expect(400)).body.message).toBe('Unknown field "owner".');
    expect((await http().post(`${base}/c/tasks`).set('x-app-session', ann.token).send({ title: 'x', priority: 'urgent' }).expect(400)).body.message).toMatch(/one of: low, normal, high/);
    await http().post(`${base}/c/tasks`).set('x-app-session', ann.token).send({ title: 'x'.repeat(121) }).expect(400);
    await http().post(`${base}/c/projects`).set('x-app-session', ann.token).send({ title: 'x' }).expect(404);

    const bob = await signUp(base, 'bob@example.com');
    expect((await http().get(`${base}/c/tasks`).set('x-app-session', bob.token).expect(200)).body.items).toEqual([]);
    await http().get(`${base}/c/tasks/${t.id}`).set('x-app-session', bob.token).expect(404);
    await http().patch(`${base}/c/tasks/${t.id}`).set('x-app-session', bob.token).send({ done: true }).expect(404);
    await http().delete(`${base}/c/tasks/${t.id}`).set('x-app-session', bob.token).expect(404);

    const done = (await http().patch(`${base}/c/tasks/${t.id}`).set('x-app-session', ann.token).send({ done: true }).expect(200)).body;
    expect(done).toMatchObject({ title: 'Buy milk', done: true });
    await http().patch(`${base}/c/tasks/${t.id}`).set('x-app-session', ann.token).send({ title: null }).expect(400); // still required after merge
    for (let i = 0; i < 3; i++) await http().post(`${base}/c/tasks`).set('x-app-session', ann.token).send({ title: `T${i}`, done: i === 1 }).expect(201);
    const page1 = (await http().get(`${base}/c/tasks?limit=2`).set('x-app-session', ann.token).expect(200)).body;
    expect(page1.items.map((x: { title: string }) => x.title)).toEqual(['T2', 'T1']);
    const page2 = (await http().get(`${base}/c/tasks?limit=2&cursor=${page1.nextCursor}`).set('x-app-session', ann.token).expect(200)).body;
    expect(page2.items.map((x: { title: string }) => x.title)).toEqual(['T0', 'Buy milk']);
    expect((await http().get(`${base}/c/tasks?f.done=true`).set('x-app-session', ann.token).expect(200)).body.items.map((x: { title: string }) => x.title)).toEqual(['T1', 'Buy milk']);
    await http().get(`${base}/c/tasks?f.done=maybe`).set('x-app-session', ann.token).expect(400);

    await http().delete(`${base}/c/tasks/${t.id}`).set('x-app-session', ann.token).expect(200);
    await http().post(`${base}/auth/signout`).set('x-app-session', ann.token).expect(200);
    await http().get(`${base}/auth/me`).set('x-app-session', ann.token).expect(401);
    await http().get(`${base}/c/tasks`).set('x-app-session', 'ast_forged-token-value').expect(401);
  });

  it('applies public, signed-in and read-only rules exactly as declared', async () => {
    const { a, id, base } = await fullstack('fs3');
    const rules = { auth: { enabled: true }, collections: {
      tasks: JSON.parse(fx('tasks-backend.json')).collections.tasks,
      guestbook: { fields: { name: { type: 'string', required: true, max: 40 }, message: { type: 'text', required: true, max: 500 } }, access: { read: 'public', create: 'public', modify: 'none' } },
      posts: { fields: { body: { type: 'text', required: true } }, access: { read: 'users', create: 'users', modify: 'owner' } },
    } };
    provider.queue([JSON.stringify({ summary: 'Add a guestbook and posts', patches: patches({ 'app.backend.json': JSON.stringify(rules, null, 2) }) })]);
    const run = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'add a guestbook', mode: 'build' }).expect(202);
    await gen.waitFor(run.body.id);
    expect((await http().get(`${V}/generations/${run.body.id}`).set('Authorization', a.auth)).body.status).toBe('succeeded');

    const g = (await http().post(`${base}/c/guestbook`).send({ name: 'Visitor', message: 'Hello!' }).expect(201)).body;
    expect(g.mine).toBe(false);
    expect((await http().get(`${base}/c/guestbook`).expect(200)).body.items).toHaveLength(1);
    const u = await signUp(base, 'carol@example.com');
    await http().patch(`${base}/c/guestbook/${g.id}`).set('x-app-session', u.token).send({ message: 'edited' }).expect(403);
    await http().delete(`${base}/c/guestbook/${g.id}`).set('x-app-session', u.token).expect(403);

    await http().get(`${base}/c/posts`).expect(401);
    const p = (await http().post(`${base}/c/posts`).set('x-app-session', u.token).send({ body: 'For members' }).expect(201)).body;
    const d = await signUp(base, 'dan@example.com');
    const seen = (await http().get(`${base}/c/posts`).set('x-app-session', d.token).expect(200)).body.items;
    expect(seen).toEqual([expect.objectContaining({ id: p.id, body: 'For members', mine: false })]);
    expect(JSON.stringify(seen)).not.toContain('carol@example.com'); // other users' identities are never exposed
    await http().patch(`${base}/c/posts/${p.id}`).set('x-app-session', d.token).send({ body: 'hijack' }).expect(403);
  });

  it('keeps preview and live data apart, serves live only while published, and uses the published schema', async () => {
    const { a, id, base } = await fullstack('fs4');
    await signUp(base, 'tester@example.com');
    await http().get(`${V}/appdata/lv_${id}/auth/me`).expect(404); // not published yet

    const pub = (await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'public', publicTitle: 'Taskly', publicDescription: 'Tasks with accounts', category: 'other' }).expect(200)).body;
    const play = (await http().get(`${V}/showcase/${pub.slug}/play`).expect(200)).body;
    expect(play.backend).toBe(true);
    const live = `${V}/appdata/${keyOf(play.html)}`;
    expect(live).toBe(`${V}/appdata/lv_${id}`);
    expect(play.html).toContain('"env":"live"');
    expect(play.html).not.toContain('pv_'); // the preview key never reaches the public page

    // The tester's preview account does not exist in the live app; tokens don't cross environments.
    await http().post(`${live}/auth/signin`).send({ email: 'tester@example.com', password: 'correct horse 1' }).expect(401);
    const liveUser = await signUp(live, 'tester@example.com');
    await http().get(`${base}/auth/me`).set('x-app-session', liveUser.token).expect(401);
    await http().post(`${live}/c/tasks`).set('x-app-session', liveUser.token).send({ title: 'Real task' }).expect(201);

    // A private edit adds a collection: preview gets it, live keeps the published schema.
    provider.queue([JSON.stringify({ summary: 'Add notes', patches: patches({ 'app.backend.json': JSON.stringify({ auth: { enabled: true }, collections: { ...JSON.parse(fx('tasks-backend.json')).collections, notes: { fields: { text: { type: 'text', required: true } }, access: { read: 'owner', create: 'users', modify: 'owner' } } } }, null, 2) }) })]);
    const run = await http().post(`${V}/projects/${id}/generations`).set('Authorization', a.auth).send({ prompt: 'add notes', mode: 'build' }).expect(202);
    await gen.waitFor(run.body.id);
    const edit = (await http().get(`${V}/generations/${run.body.id}`).set('Authorization', a.auth)).body;
    expect(edit.status, edit.error).toBe('succeeded');
    const previewUser = await signUp(base, 'p2@example.com');
    await http().post(`${base}/c/notes`).set('x-app-session', previewUser.token).send({ text: 'hi' }).expect(201);
    await http().post(`${live}/c/notes`).set('x-app-session', liveUser.token).send({ text: 'hi' }).expect(404);

    // Owner view: counts per environment, users, and live data untouched by clearing preview.
    const ov = (await http().get(`${V}/projects/${id}/data?env=live`).set('Authorization', a.auth).expect(200)).body;
    expect(ov).toMatchObject({ env: 'live', available: true, users: 1 });
    expect(ov.collections.find((c: { name: string }) => c.name === 'tasks').records).toBe(1);
    const users = (await http().get(`${V}/projects/${id}/data/users?env=live`).set('Authorization', a.auth).expect(200)).body;
    expect(users).toEqual([expect.objectContaining({ email: 'tester@example.com', records: 1 })]);
    expect(JSON.stringify(users)).not.toContain('scrypt');
    const cleared = (await http().post(`${V}/projects/${id}/data/clear-preview`).set('Authorization', a.auth).expect(200)).body;
    expect(cleared).toEqual({ records: 1, users: 2 });
    expect((await http().get(`${V}/projects/${id}/data?env=live`).set('Authorization', a.auth)).body.users).toBe(1);

    await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'private' }).expect(200);
    await http().get(`${live}/auth/me`).set('x-app-session', liveUser.token).expect(404);
  });

  it('isolates apps from each other and from other workspaces, and lets the owner remove an end user and their data', async () => {
    const one = await fullstack('fs5');
    const two = await fullstack('fs6');
    const u = await signUp(one.base, 'eve@example.com');
    await http().get(`${two.base}/auth/me`).set('x-app-session', u.token).expect(401);
    await http().get(`${V}/projects/${one.id}/data`).set('Authorization', two.a.auth).expect(404);
    await http().get(`${V}/projects/${one.id}/data/users`).set('Authorization', two.a.auth).expect(404);
    await http().post(`${V}/projects/${one.id}/data/clear-preview`).set('Authorization', two.a.auth).expect(404);
    await http().get(`${V}/appdata/pv_${'x'.repeat(32)}/auth/me`).expect(404);

    await http().post(`${one.base}/c/tasks`).set('x-app-session', u.token).send({ title: 'mine' }).expect(201);
    const recs = (await http().get(`${V}/projects/${one.id}/data/records?collection=tasks`).set('Authorization', one.a.auth).expect(200)).body.items;
    expect(recs).toEqual([expect.objectContaining({ owner: 'eve@example.com', data: { title: 'mine' } })]);
    const users = (await http().get(`${V}/projects/${one.id}/data/users`).set('Authorization', one.a.auth)).body;
    await http().delete(`${V}/projects/${one.id}/data/users/${users[0].id}`).set('Authorization', one.a.auth).expect(204);
    expect(await prisma.appRecord.count({ where: { projectId: one.id } })).toBe(0);
    expect(await prisma.appSession.count()).toBe(0);
    await http().get(`${one.base}/auth/me`).set('x-app-session', u.token).expect(401);
    expect(await prisma.auditLog.count({ where: { action: 'appdata.user_deleted' } })).toBe(1);
  });

  it('enforces storage limits, the kill switch, and open CORS on the data API only', async () => {
    const { base } = await fullstack('fs7');
    const u = await signUp(base, 'max@example.com');
    for (let i = 0; i < 25; i++) await http().post(`${base}/c/tasks`).set('x-app-session', u.token).send({ title: `t${i}` }).expect(201);
    expect((await http().post(`${base}/c/tasks`).set('x-app-session', u.token).send({ title: 'one too many' }).expect(409)).body.code).toBe('record_limit');

    const pre = await http().options(`${base}/c/tasks`).set('Origin', 'null').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,x-app-session').expect(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');
    expect(pre.headers['access-control-allow-headers']).toContain('x-app-session');
    const res = await http().get(`${base}/c/tasks`).set('Origin', 'null').set('x-app-session', u.token).expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    const platform = await http().get(`${V}/me`).set('Origin', 'null');
    expect(platform.headers['access-control-allow-origin']).not.toBe('*');
    expect(platform.headers['access-control-allow-origin']).not.toBe('null');

    await prisma.platformFlag.create({ data: { key: 'app_backends', enabled: false, description: 'off' } });
    (app.get(FlagsService) as unknown as { cache: unknown }).cache = null;
    await http().get(`${base}/c/tasks`).set('x-app-session', u.token).expect(503);
    (app.get(FlagsService) as unknown as { cache: unknown }).cache = null;
  });

  it('repairs an app whose code uses an undeclared collection before saving it', async () => {
    const a = await login('fs8');
    const broken = { ...TASKS, 'app.js': `${TASKS['app.js']}\nApp.db.list('projects');\n` };
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), JSON.stringify({ summary: 'Draft', patches: patches(broken) }), JSON.stringify({ diagnosis: 'Removed the undeclared collection', patches: patches({ 'app.js': TASKS['app.js']! }) })]);
    const { run } = await build(a.auth, 'tasks');
    expect(run.status).toBe('succeeded');
  });
});

describe('free services for full-stack apps', () => {
  it('serves cached ECB exchange rates and built-in country data to apps only, with clear errors', async () => {
    const { base } = await fullstack('sv1');
    upstream.length = 0; ratesDown = false;
    const r = (await http().get(`${base}/services/currency/latest?base=usd&symbols=INR,EUR`).expect(200)).body;
    expect(r).toEqual({ base: 'USD', date: '2026-11-13', rates: { INR: 88.4, EUR: 0.86 }, source: expect.stringContaining('European Central Bank') });
    await http().get(`${base}/services/currency/latest?base=USD&symbols=GBP`).expect(200);
    expect(upstream).toEqual(['https://api.frankfurter.dev/v1/latest?base=USD']); // one upstream call serves both
    expect((await http().get(`${base}/services/currency/latest?base=USD&symbols=JPY`).expect(400)).body.message).toBe('Not supported: JPY.');
    await http().get(`${base}/services/currency/latest?base=usd1`).expect(400);
    await http().get(`${base}/services/currency/latest?base=XXX`).expect(400);

    ratesDown = true;
    expect((await http().get(`${base}/services/currency/latest?base=USD`).expect(200)).body.rates.INR).toBe(88.4); // cached
    expect((await http().get(`${base}/services/currency/latest?base=EUR`).expect(503)).body.message).toMatch(/unavailable right now/);
    ratesDown = false;

    const countries = (await http().get(`${base}/services/countries`).expect(200)).body as { code: string; name: string; flag: string }[];
    expect(countries.length).toBeGreaterThanOrEqual(245);
    expect(countries).toContainEqual({ code: 'IN', name: 'India', flag: '🇮🇳' });
    expect(countries.some((c) => ['EU', 'UN', 'ZZ', 'SU', 'YU'].includes(c.code))).toBe(false);
    expect(countries.map((c) => c.name)).toEqual([...countries.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'en')));
    const hi = (await http().get(`${base}/services/countries?lang=hi`).expect(200)).body as { code: string; name: string }[];
    expect(hi.find((c) => c.code === 'IN')!.name).toBe('भारत');

    // Not an open proxy: unknown or unpublished apps get nothing, and the kill switch works.
    await http().get(`${V}/appdata/pv_${'y'.repeat(32)}/services/countries`).expect(404);
    await prisma.platformFlag.create({ data: { key: 'app_services', enabled: false, description: 'off' } });
    (app.get(FlagsService) as unknown as { cache: unknown }).cache = null;
    await http().get(`${base}/services/countries`).expect(503);
    (app.get(FlagsService) as unknown as { cache: unknown }).cache = null;
  });
});
