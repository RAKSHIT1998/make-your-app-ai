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


async function published(owner: { auth: string }) {
  const id = await newProject(owner.auth);
  provider.queue(CREATE_SCRIPT);
  expect((await generate(owner.auth, id, 'A boutique lakeside hotel')).status).toBe(202);
  const pub = (await http().put(`${V}/projects/${id}/publishing`).set('Authorization', owner.auth).send({ visibility: 'public', publicTitle: 'Grand Lake Hotel', publicDescription: 'A calm lakeside stay', category: 'business' }).expect(200)).body;
  return { id, slug: pub.slug as string, pub };
}

describe('showcase: publish, explore, like, view, remix', () => {
  it('only generated projects can be published; publishing freezes a snapshot and assigns a handle', async () => {
    const a = await login('creator');
    const empty = await newProject(a.auth);
    await http().put(`${V}/projects/${empty}/publishing`).set('Authorization', a.auth).send({ visibility: 'public' }).expect(400);
    const { id, slug, pub } = await published(a);
    expect(pub).toMatchObject({ visibility: 'public', outdated: false, canHideAttribution: false, showAttribution: true });
    expect(pub.creatorHandle).toMatch(/^creator/);
    // Free plans must keep the attribution badge.
    await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'public', showAttribution: false }).expect(402);

    const page = (await http().get(`${V}/showcase/${slug}`).expect(200)).body;
    expect(page).toMatchObject({ title: 'Grand Lake Hotel', category: 'business', likes: 0, isOwner: false, likedByMe: false, preview: null, showAttribution: true });
    expect(page.pages.length).toBeGreaterThan(0);
    expect(page.fileCount).toBeGreaterThan(0);
    expect(JSON.stringify(page)).not.toContain(a.email); // no private data on public pages

    // A later private edit is not exposed until republished.
    provider.queue([JSON.stringify({ summary: 'Penthouse', patches: [{ op: 'update', path: 'lib/rooms.ts', content: ROOMS_LIB.replace('Lake', 'Penthouse'), reason: '' }] })]);
    await generate(a.auth, id, 'Add a penthouse');
    expect((await http().get(`${V}/projects/${id}/publishing`).set('Authorization', a.auth)).body.outdated).toBe(true);

    // Unpublish hides it everywhere.
    await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'private' }).expect(200);
    await http().get(`${V}/showcase/${slug}`).expect(404);
    expect((await http().get(`${V}/explore?sort=recent`).expect(200)).body.items).toHaveLength(0);
  });

  it('explore lists, searches and filters public projects; likes and daily views are counted once', async () => {
    const a = await login('maker');
    const { slug } = await published(a);
    const b = await login('fan');
    const list = (await http().get(`${V}/explore`).expect(200)).body;
    expect(list.items.map((i: { slug: string }) => i.slug)).toEqual([slug]);
    expect((await http().get(`${V}/explore?q=lakeside`).expect(200)).body.items).toHaveLength(1);
    expect((await http().get(`${V}/explore?q=zebra`).expect(200)).body.items).toHaveLength(0);
    expect((await http().get(`${V}/explore?category=restaurant`).expect(200)).body.items).toHaveLength(0);
    expect((await http().get(`${V}/explore?sort=featured`).expect(200)).body.items).toHaveLength(0);

    await http().put(`${V}/showcase/${slug}/like`).expect(401);
    expect((await http().put(`${V}/showcase/${slug}/like`).set('Authorization', b.auth).expect(200)).body).toEqual({ liked: true, likes: 1 });
    expect((await http().put(`${V}/showcase/${slug}/like`).set('Authorization', b.auth).expect(200)).body.likes).toBe(1);
    expect((await http().get(`${V}/showcase/${slug}`).set('Authorization', b.auth)).body.likedByMe).toBe(true);
    expect((await http().delete(`${V}/showcase/${slug}/like`).set('Authorization', b.auth).expect(200)).body.likes).toBe(0);

    expect((await http().post(`${V}/showcase/${slug}/view`).set('Authorization', b.auth).expect(200)).body.counted).toBe(true);
    expect((await http().post(`${V}/showcase/${slug}/view`).set('Authorization', b.auth).expect(200)).body.counted).toBe(false);
    expect((await http().post(`${V}/showcase/${slug}/view`).set('Authorization', a.auth).expect(200)).body.counted).toBe(false); // owner
    expect((await http().get(`${V}/showcase/${slug}`)).body.views).toBe(1);

    const creator = (await http().get(`${V}/creators/${(await http().get(`${V}/me`).set('Authorization', a.auth)).body.handle}`).expect(200)).body;
    expect(creator.totals.projects).toBe(1);
  });

  it('remix creates a separate project from the PUBLISHED version, keeps lineage, and respects the creator’s setting', async () => {
    const a = await login('orig');
    const { id, slug } = await published(a);
    provider.queue([JSON.stringify({ summary: 'Private edit', patches: [{ op: 'update', path: 'lib/rooms.ts', content: 'export const rooms = [];\n// SECRET DRAFT', reason: '' }] })]);
    await generate(a.auth, id, 'private draft');
    // A stray secrets file in the source must never travel.
    const b = await login('remixer');
    await http().post(`${V}/showcase/${slug}/remix`).send({}).expect(401);
    const r = (await http().post(`${V}/showcase/${slug}/remix`).set('Authorization', b.auth).send({}).expect(201)).body;
    expect(r).toMatchObject({ name: 'Remix of Grand Lake Hotel', status: 'ready' });
    expect(r.organizationId).toBe(b.orgId);
    const files = (await http().get(`${V}/projects/${r.id}/files`).set('Authorization', b.auth).expect(200)).body;
    expect(files.length).toBeGreaterThan(3);
    const rooms = (await http().get(`${V}/projects/${r.id}/file?path=lib/rooms.ts`).set('Authorization', b.auth)).body;
    expect(JSON.stringify(rooms)).not.toContain('SECRET DRAFT');
    expect((await http().get(`${V}/projects/${r.id}/versions`).set('Authorization', b.auth)).body[0].message).toContain('Remixed from');
    // Original untouched and still owned by A; B can't see A's project.
    await http().get(`${V}/projects/${id}`).set('Authorization', b.auth).expect(404);
    expect((await http().get(`${V}/showcase/${slug}`)).body.remixes).toBe(1);
    // Lineage shows on the remix once it is published.
    const rp = (await http().put(`${V}/projects/${r.id}/publishing`).set('Authorization', b.auth).send({ visibility: 'public' }).expect(200)).body;
    expect((await http().get(`${V}/showcase/${rp.slug}`)).body.remixedFrom).toMatchObject({ slug });
    // Creator turns remixing off.
    await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'public', allowRemix: false }).expect(200);
    await http().post(`${V}/showcase/${slug}/remix`).set('Authorization', b.auth).send({}).expect(403);
  });

  it('reports: three distinct reporters hide a project until a moderator reviews it; owners can feature and restore', async () => {
    const a = await login('owner-of-thing');
    const { id, slug } = await published(a);
    await http().post(`${V}/showcase/${slug}/report`).set('Authorization', a.auth).send({ reason: 'spam' }).expect(400);
    for (const n of ['r1', 'r2']) await http().post(`${V}/showcase/${slug}/report`).set('Authorization', (await login(n)).auth).send({ reason: 'spam' }).expect(201);
    await http().get(`${V}/showcase/${slug}`).expect(200);
    await http().post(`${V}/showcase/${slug}/report`).set('Authorization', (await login('r3')).auth).send({ reason: 'abuse', details: 'bad' }).expect(201);
    await http().get(`${V}/showcase/${slug}`).expect(404);
    await http().put(`${V}/projects/${id}/publishing`).set('Authorization', a.auth).send({ visibility: 'public' }).expect(403);

    const mod = await login('mod');
    await http().get(`${V}/admin/growth/showcase`).set('Authorization', mod.auth).expect(404);
    await prisma.user.update({ where: { id: mod.id }, data: { platformRole: 'admin' } });
    const q = (await http().get(`${V}/admin/growth/showcase`).set('Authorization', mod.auth).expect(200)).body;
    expect(q.reports).toHaveLength(3);
    await http().post(`${V}/admin/growth/projects/${id}/restore`).set('Authorization', mod.auth).expect(201);
    await http().get(`${V}/showcase/${slug}`).expect(200);
    await http().post(`${V}/admin/growth/projects/${id}/feature`).set('Authorization', mod.auth).send({ featured: true }).expect(201);
    expect((await http().get(`${V}/explore?sort=featured`)).body.items[0]).toMatchObject({ slug, featured: true });
    expect((await http().get(`${V}/admin/growth/showcase`).set('Authorization', mod.auth)).body.reports).toHaveLength(0);
  });

  it('handles are validated, unique and reserved words are blocked', async () => {
    const a = await login('h1');
    const b = await login('h2');
    await http().patch(`${V}/me`).set('Authorization', a.auth).send({ handle: 'lake-builder', bio: 'I build hotels' }).expect(200);
    await http().patch(`${V}/me`).set('Authorization', b.auth).send({ handle: 'lake-builder' }).expect(409);
    await http().patch(`${V}/me`).set('Authorization', b.auth).send({ handle: 'admin' }).expect(400);
    await http().patch(`${V}/me`).set('Authorization', b.auth).send({ handle: 'Bad Handle!' }).expect(400);
    expect((await http().get(`${V}/creators/lake-builder`).expect(200)).body).toMatchObject({ handle: 'lake-builder', bio: 'I build hotels', totals: { projects: 0 } });
  });
});
