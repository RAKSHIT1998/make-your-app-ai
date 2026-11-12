import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());

beforeAll(async () => ({ app, prisma } = await createTestApp()));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(() => resetDb(prisma));

describe('health', () => {
  it('is public and reports the database', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });
});

describe('authentication', () => {
  it('rejects missing, forged and wrong-audience tokens', async () => {
    const u = newIdentity('a');
    await http().get('/me').expect(401);
    await http().get('/me').set('Authorization', `Bearer ${await tokenFor(u.id, u.email, { secret: 'x'.repeat(40) })}`).expect(401);
    await http().get('/me').set('Authorization', `Bearer ${await tokenFor(u.id, u.email, { aud: 'anon' })}`).expect(401);
    await http().get('/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
  });

  it('provisions the user and a personal org on first request, idempotently', async () => {
    const u = newIdentity('alice');
    const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
    const first = await http().get('/me').set('Authorization', auth).expect(200);
    const second = await http().get('/me').set('Authorization', auth).expect(200);
    expect(first.body.id).toBe(u.id);
    expect(first.body.organizations).toHaveLength(1);
    expect(first.body.organizations[0]).toMatchObject({ personal: true, role: 'owner' });
    expect(second.body.personalOrgId).toBe(first.body.personalOrgId);
    expect(await prisma.organization.count()).toBe(1);
  });

  it('provisions safely when a new user fires many requests at once', async () => {
    const u = newIdentity('burst');
    const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => http().get(i % 2 ? '/me' : '/projects').set('Authorization', auth)));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
  });

  it('blocks suspended accounts', async () => {
    const u = newIdentity('sus');
    const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
    await http().get('/me').set('Authorization', auth).expect(200);
    await prisma.user.update({ where: { id: u.id }, data: { status: 'suspended' } });
    await http().get('/me').set('Authorization', auth).expect(403);
  });
});

describe('projects', () => {
  async function login(label: string) {
    const u = newIdentity(label);
    const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
    const me = await http().get('/me').set('Authorization', auth).expect(200);
    return { ...u, auth, orgId: me.body.personalOrgId as string };
  }

  it('creates, reads, updates, lists and soft-deletes with audit records', async () => {
    const a = await login('a');
    const created = await http()
      .post('/projects')
      .set('Authorization', a.auth)
      .send({ name: 'Hotel site', type: 'website', description: 'Rooms + bookings' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Hotel site', type: 'website', status: 'draft', organizationId: a.orgId });

    const id = created.body.id;
    await http().get(`/projects/${id}`).set('Authorization', a.auth).expect(200);
    const patched = await http().patch(`/projects/${id}`).set('Authorization', a.auth).send({ name: 'Grand Hotel' }).expect(200);
    expect(patched.body.name).toBe('Grand Hotel');

    const list = await http().get('/projects').set('Authorization', a.auth).expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([id]);

    await http().delete(`/projects/${id}`).set('Authorization', a.auth).expect(204);
    await http().get(`/projects/${id}`).set('Authorization', a.auth).expect(404);
    expect((await http().get('/projects').set('Authorization', a.auth)).body.items).toEqual([]);

    const actions = (await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { id: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual(['project.created', 'project.updated', 'project.deleted']);
  });

  it('validates input', async () => {
    const a = await login('a');
    const res = await http().post('/projects').set('Authorization', a.auth).send({ name: '', type: 'spaceship' }).expect(400);
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(['name', 'type']);
    await http().get('/projects/not-a-uuid').set('Authorization', a.auth).expect(400);
  });

  it('isolates tenants: other users get 404, never the data', async () => {
    const a = await login('a');
    const b = await login('b');
    const { body: p } = await http().post('/projects').set('Authorization', a.auth).send({ name: 'Secret', type: 'saas' }).expect(201);

    await http().get(`/projects/${p.id}`).set('Authorization', b.auth).expect(404);
    await http().patch(`/projects/${p.id}`).set('Authorization', b.auth).send({ name: 'pwned' }).expect(404);
    await http().delete(`/projects/${p.id}`).set('Authorization', b.auth).expect(404);
    await http().get(`/projects?organizationId=${a.orgId}`).set('Authorization', b.auth).expect(404);
    await http().post('/projects').set('Authorization', b.auth).send({ name: 'x', type: 'saas', organizationId: a.orgId }).expect(404);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).name).toBe('Secret');
  });

  it('enforces org roles: viewer reads only, member edits but cannot delete', async () => {
    const a = await login('a');
    const viewer = await login('viewer');
    const member = await login('member');
    await prisma.organizationMembership.createMany({
      data: [
        { organizationId: a.orgId, userId: viewer.id, role: 'viewer' },
        { organizationId: a.orgId, userId: member.id, role: 'member' },
      ],
    });
    const { body: p } = await http().post('/projects').set('Authorization', a.auth).send({ name: 'Team app', type: 'mobile_app' }).expect(201);

    await http().get(`/projects/${p.id}`).set('Authorization', viewer.auth).expect(200);
    await http().patch(`/projects/${p.id}`).set('Authorization', viewer.auth).send({ name: 'v' }).expect(403);
    await http().post('/projects').set('Authorization', viewer.auth).send({ name: 'v', type: 'saas', organizationId: a.orgId }).expect(403);

    await http().patch(`/projects/${p.id}`).set('Authorization', member.auth).send({ name: 'm' }).expect(200);
    await http().delete(`/projects/${p.id}`).set('Authorization', member.auth).expect(403);
    await http().delete(`/projects/${p.id}`).set('Authorization', a.auth).expect(204);
  });

  it('paginates with a cursor', async () => {
    const a = await login('a');
    for (let i = 0; i < 5; i++) {
      await http().post('/projects').set('Authorization', a.auth).send({ name: `P${i}`, type: 'website' }).expect(201);
    }
    const page1 = await http().get('/projects?limit=2').set('Authorization', a.auth).expect(200);
    const page2 = await http().get(`/projects?limit=2&cursor=${page1.body.nextCursor}`).set('Authorization', a.auth).expect(200);
    const page3 = await http().get(`/projects?limit=2&cursor=${page2.body.nextCursor}`).set('Authorization', a.auth).expect(200);
    const names = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((p: { name: string }) => p.name);
    expect(new Set(names).size).toBe(5);
    expect(page3.body.nextCursor).toBeNull();
  });
});
