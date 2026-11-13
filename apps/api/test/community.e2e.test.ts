import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());
const V = '/api/v1';
beforeAll(async () => ({ app, prisma } = await createTestApp({ env: { TRUST_PROXY: '1' } })));
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma); });

type P = { id: string; email: string; auth: string; orgId: string };
const seq = { n: 0 };
async function person(label: string): Promise<P> {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = (await http().get(`${V}/me`).set('Authorization', auth).expect(200)).body;
  return { ...u, auth, orgId: me.personalOrgId };
}
// Each call comes from a distinct client address so route throttles don't see the suite as one caller.
const as = (p: P) => {
  const ip = `10.9.${seq.n++ % 250}.${(parseInt(p.id.slice(0, 2), 16) % 250) + 1}`;
  const h = (r: request.Test) => r.set('Authorization', p.auth).set('x-forwarded-for', ip);
  return { get: (u: string) => h(http().get(`${V}${u}`)), post: (u: string, b: object = {}) => h(http().post(`${V}${u}`).send(b)), put: (u: string, b: object = {}) => h(http().put(`${V}${u}`).send(b)), patch: (u: string, b: object) => h(http().patch(`${V}${u}`).send(b)), del: (u: string) => h(http().delete(`${V}${u}`)) };
};

async function publish(owner: P, title = 'Grand Lake') {
  const id = (await as(owner).post('/projects', { name: title, type: 'website' }).expect(201)).body.id as string;
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  await app.get(GenerationsService).importTree(project, new Map([['app/page.tsx', 'export default function P(){return <h1>Hi</h1>}']]), 'seed');
  const pub = (await as(owner).put(`/projects/${id}/publishing`, { visibility: 'public', publicTitle: title }).expect(200)).body;
  return { id, slug: pub.slug as string };
}

describe('comments', () => {
  it('lets signed-in people comment and reply one level deep; names never expose emails', async () => {
    const owner = await person('owner'); const fan = await person('fan');
    const { slug } = await publish(owner);
    await http().post(`${V}/showcase/${slug}/comments`).send({ body: 'hi' }).expect(401);
    const top = (await as(fan).post(`/showcase/${slug}/comments`, { body: 'Love the colours' }).expect(201)).body;
    const reply = (await as(owner).post(`/showcase/${slug}/comments`, { body: 'Thank you!', parentId: top.id }).expect(201)).body;
    expect(reply.byCreator).toBe(true);
    await as(fan).post(`/showcase/${slug}/comments`, { body: 'Reply to reply', parentId: reply.id }).expect(400);

    const anon = (await http().get(`${V}/showcase/${slug}/comments`).expect(200)).body;
    expect(anon.items).toHaveLength(2);
    expect(JSON.stringify(anon)).not.toContain('@example.test');
    expect(anon.items.every((c: { mine: boolean; canRemove: boolean }) => !c.mine && !c.canRemove)).toBe(true);
    const asOwner = (await as(owner).get(`/showcase/${slug}/comments`).expect(200)).body;
    expect(asOwner.items.every((c: { canRemove: boolean }) => c.canRemove)).toBe(true);
  });

  it('limits links, duplicates and speed, and respects the creator turning comments off', async () => {
    const owner = await person('owner'); const fan = await person('fan');
    const { id, slug } = await publish(owner);
    await as(fan).post(`/showcase/${slug}/comments`, { body: 'see http://a.example http://b.example http://c.example' }).expect(400);
    await as(fan).post(`/showcase/${slug}/comments`, { body: 'Nice one' }).expect(201);
    await as(fan).post(`/showcase/${slug}/comments`, { body: 'Nice one' }).expect(409);
    for (let i = 0; i < 9; i++) await as(fan).post(`/showcase/${slug}/comments`, { body: `Comment number ${i}` }).expect(201);
    await as(fan).post(`/showcase/${slug}/comments`, { body: 'One too many' }).expect(429);

    const other = await person('other');
    await as(owner).put(`/projects/${id}/publishing`, { visibility: 'public', commentsEnabled: false }).expect(200);
    await as(other).post(`/showcase/${slug}/comments`, { body: 'Hello there' }).expect(403);
    expect((await http().get(`${V}/showcase/${slug}/comments`).expect(200)).body.enabled).toBe(false);
  });

  it('can be removed by the author, the project owner or a moderator — and by nobody else', async () => {
    const owner = await person('owner'); const fan = await person('fan'); const rando = await person('rando');
    const { slug } = await publish(owner);
    const c1 = (await as(fan).post(`/showcase/${slug}/comments`, { body: 'First' }).expect(201)).body;
    const c2 = (await as(fan).post(`/showcase/${slug}/comments`, { body: 'Second' }).expect(201)).body;
    await as(rando).del(`/comments/${c1.id}`).expect(404);
    await as(fan).del(`/comments/${c1.id}`).expect(204);
    await as(owner).del(`/comments/${c2.id}`).expect(204);
    expect((await http().get(`${V}/showcase/${slug}/comments`).expect(200)).body.items).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: 'comment.removed' } })).toBe(1); // author's own removal isn't a moderation event
    await as(fan).del(`/comments/${c1.id}`).expect(404);
  });

  it('auto-hides after three distinct reports and gives moderators a queue to decide from', async () => {
    const owner = await person('owner'); const poster = await person('poster');
    const { slug } = await publish(owner);
    const bad = (await as(poster).post(`/showcase/${slug}/comments`, { body: 'Buy cheap stuff now' }).expect(201)).body;
    await as(poster).post(`/comments/${bad.id}/report`, { reason: 'spam' }).expect(400);
    const reporters = [await person('r1'), await person('r2'), await person('r3')];
    await as(reporters[0]!).post(`/comments/${bad.id}/report`, { reason: 'spam' }).expect(200);
    expect((await as(reporters[0]!).post(`/comments/${bad.id}/report`, { reason: 'spam' }).expect(200)).body.duplicate).toBe(true);
    await as(reporters[1]!).post(`/comments/${bad.id}/report`, { reason: 'spam' }).expect(200);
    expect((await http().get(`${V}/showcase/${slug}/comments`).expect(200)).body.items).toHaveLength(1);
    await as(reporters[2]!).post(`/comments/${bad.id}/report`, { reason: 'abuse' }).expect(200);
    expect((await http().get(`${V}/showcase/${slug}/comments`).expect(200)).body.items).toHaveLength(0);

    const admin = await person('admin');
    await as(admin).get('/admin/growth/comments').expect(404);
    await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'admin' } });
    const queue = (await as(admin).get('/admin/growth/comments').expect(200)).body;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: bad.id, status: 'hidden', reports: ['spam', 'spam', 'abuse'] });
    await as(admin).post(`/admin/growth/comments/${bad.id}/moderate`, { action: 'restore' }).expect(201);
    expect((await http().get(`${V}/showcase/${slug}/comments`).expect(200)).body.items).toHaveLength(1);
    expect((await as(admin).get('/admin/growth/comments').expect(200)).body).toHaveLength(0);
    await as(admin).post(`/admin/growth/comments/${bad.id}/moderate`, { action: 'remove' }).expect(201);
    expect(await prisma.auditLog.count({ where: { action: { in: ['admin.comment_restored', 'admin.comment_removed'] } } })).toBe(2);
  });

  it('stops showing comments when the project is unpublished', async () => {
    const owner = await person('owner'); const fan = await person('fan');
    const { id, slug } = await publish(owner);
    await as(fan).post(`/showcase/${slug}/comments`, { body: 'Great work' }).expect(201);
    await as(owner).put(`/projects/${id}/publishing`, { visibility: 'private' }).expect(200);
    await http().get(`${V}/showcase/${slug}/comments`).expect(404);
    await as(fan).post(`/showcase/${slug}/comments`, { body: 'Still there?' }).expect(404);
  });
});

describe('follows', () => {
  it('follows and unfollows creators, counts followers, and builds a feed from followed creators only', async () => {
    const creator = await person('creator'); const other = await person('other'); const fan = await person('fan');
    await publish(creator, 'Creator Site'); await publish(other, 'Other Site');
    const handle = (await prisma.user.findUniqueOrThrow({ where: { id: creator.id } })).handle!;
    expect((await as(fan).get('/feed/following').expect(200)).body).toMatchObject({ items: [], followingCount: 0 });

    expect((await as(fan).put(`/creators/${handle}/follow`).expect(200)).body).toEqual({ following: true, followers: 1 });
    expect((await as(fan).put(`/creators/${handle}/follow`).expect(200)).body.followers).toBe(1);
    await as(creator).put(`/creators/${handle}/follow`).expect(400);
    await as(fan).put('/creators/nobody-here/follow').expect(404);

    const page = (await as(fan).get(`/creators/${handle}`).expect(200)).body;
    expect(page).toMatchObject({ followers: 1, followedByMe: true });
    expect((await http().get(`${V}/creators/${handle}`).expect(200)).body.followedByMe).toBe(false);

    const feed = (await as(fan).get('/feed/following').expect(200)).body;
    expect(feed.items.map((i: { title: string }) => i.title)).toEqual(['Creator Site']);
    expect((await as(fan).del(`/creators/${handle}/follow`).expect(200)).body).toEqual({ following: false, followers: 0 });
    expect((await as(fan).get('/feed/following').expect(200)).body.items).toEqual([]);
    await http().get(`${V}/feed/following`).expect(401);
  });
});

describe('collections', () => {
  it('lets people curate public projects, keeps private lists private, and drops projects that stop being public', async () => {
    const owner = await person('owner'); const curator = await person('curator'); const other = await person('other');
    const a = await publish(owner, 'Alpha'); const b = await publish(owner, 'Beta');

    const col = (await as(curator).post('/collections', { name: 'Inspiration', description: 'Things I like' }).expect(201)).body;
    await as(curator).put(`/collections/${col.id}/items/${a.slug}`).expect(200);
    await as(curator).put(`/collections/${col.id}/items/${b.slug}`).expect(200);
    await as(curator).put(`/collections/${col.id}/items/${b.slug}`).expect(200);
    await as(other).put(`/collections/${col.id}/items/${a.slug}`).expect(404);
    await as(curator).put(`/collections/${col.id}/items/does-not-exist`).expect(404);

    const mine = (await as(curator).get(`/collections?slug=${a.slug}`).expect(200)).body;
    expect(mine).toEqual([expect.objectContaining({ id: col.id, count: 2, has: true, isPublic: false })]);

    await http().get(`${V}/collections/${col.id}`).expect(404);
    await as(other).get(`/collections/${col.id}`).expect(404);
    expect((await as(curator).get(`/collections/${col.id}`).expect(200)).body.items).toHaveLength(2);

    await as(other).patch(`/collections/${col.id}`, { isPublic: true }).expect(404);
    await as(curator).patch(`/collections/${col.id}`, { isPublic: true }).expect(200);
    const pub = (await http().get(`${V}/collections/${col.id}`).expect(200)).body;
    expect(pub).toMatchObject({ name: 'Inspiration', mine: false });
    expect(pub.items.map((i: { title: string }) => i.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(JSON.stringify(pub)).not.toContain('@example.test');

    await as(owner).put(`/projects/${b.id}/publishing`, { visibility: 'private' }).expect(200);
    expect((await http().get(`${V}/collections/${col.id}`).expect(200)).body.items.map((i: { title: string }) => i.title)).toEqual(['Alpha']);
    await as(curator).del(`/collections/${col.id}/items/${a.slug}`).expect(200);
    expect((await http().get(`${V}/collections/${col.id}`).expect(200)).body.items).toEqual([]);

    await as(other).del(`/collections/${col.id}`).expect(404);
    await as(curator).del(`/collections/${col.id}`).expect(204);
    await http().get(`${V}/collections/${col.id}`).expect(404);
  });

  it('caps the number of collections per person', async () => {
    const p = await person('hoarder');
    for (let i = 0; i < 20; i++) await as(p).post('/collections', { name: `List ${i}` }).expect(201);
    await as(p).post('/collections', { name: 'One more' }).expect(409);

  });
});
