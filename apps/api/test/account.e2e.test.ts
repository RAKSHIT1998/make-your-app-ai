import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { ACCOUNT_FETCH } from '../src/orgs/account.service.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

let app: INestApplication;
let prisma: PrismaClient;
const calls: { url: string; init: RequestInit }[] = [];
let supabaseStatus = 200;
const fakeFetch = async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  return new Response(null, { status: supabaseStatus });
};
const http = () => request(app.getHttpServer());
const V = '/api/v1';

beforeAll(async () => ({ app, prisma } = await createTestApp({
  env: { SUPABASE_URL: 'https://auth.example.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests-only', TRUST_PROXY: '1' },
  overrides: [{ provide: ACCOUNT_FETCH, useValue: fakeFetch }],
})));
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma); calls.length = 0; supabaseStatus = 200; });

type P = { id: string; email: string; auth: string; orgId: string };
async function person(label: string): Promise<P> {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email, { iss: 'https://auth.example.test/auth/v1' })}`;
  const me = (await http().get(`${V}/me`).set('Authorization', auth).expect(200)).body;
  return { ...u, auth, orgId: me.personalOrgId };
}
const as = (p: P) => ({
  get: (u: string) => http().get(`${V}${u}`).set('Authorization', p.auth),
  post: (u: string, b: object = {}) => http().post(`${V}${u}`).set('Authorization', p.auth).send(b),
  put: (u: string, b: object = {}) => http().put(`${V}${u}`).set('Authorization', p.auth).send(b),
  del: (u: string, b: object = {}) => http().delete(`${V}${u}`).set('Authorization', p.auth).send(b),
});
async function publishedGame(owner: P, title: string) {
  const id = (await as(owner).post('/projects', { name: title, type: 'game' }).expect(201)).body.id as string;
  const p = await prisma.project.findUniqueOrThrow({ where: { id } });
  await app.get(GenerationsService).importTree(p, new Map([['index.html', '<!doctype html><title>x</title><h1>Hi</h1>']]), 'seed');
  const pub = (await as(owner).put(`/projects/${id}/publishing`, { visibility: 'public', publicTitle: title }).expect(200)).body;
  return { id, slug: pub.slug as string };
}

describe('account deletion', () => {
  it('asks for the sign-in email, then removes the person, their workspace, projects and social traces', async () => {
    const ana = await person('ana');
    const ben = await person('ben');
    const game = await publishedGame(ana, 'Ana game');
    const benGame = await publishedGame(ben, 'Ben game');
    await as(ana).put(`/showcase/${benGame.slug}/like`).expect(200);
    await as(ben).put(`/showcase/${game.slug}/like`).expect(200);
    await prisma.user.update({ where: { id: ana.id }, data: { handle: 'ana-builds', bio: 'I make games', displayName: 'Ana' } });

    const preview = (await as(ana).get('/me/deletion').expect(200)).body;
    expect(preview).toMatchObject({ projects: 1, subscriptionsToCancel: 0, blockers: [] });
    expect(preview.workspaces).toEqual([expect.objectContaining({ id: ana.orgId, personal: true })]);

    await as(ana).del('/me', { confirmEmail: 'someone@else.test' }).expect(400);
    await as(ana).del('/me', {}).expect(400);
    const res = (await as(ana).del('/me', { confirmEmail: ana.email.toUpperCase() }).expect(200)).body;
    expect(res).toEqual({ deleted: true, workspacesClosed: 1, subscriptionsCancelled: 0, signInRemoved: true });

    // The sign-in is removed with the server-only key, never anything the caller sent.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://auth.example.test/auth/v1/admin/users/${ana.id}`);
    expect(calls[0]!.init.method).toBe('DELETE');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer service-role-key-for-tests-only');

    const u = await prisma.user.findUniqueOrThrow({ where: { id: ana.id } });
    expect(u).toMatchObject({ status: 'deleted', handle: null, displayName: null, bio: '', email: `deleted+${ana.id}@deleted.invalid` });
    expect(await prisma.organizationMembership.count({ where: { userId: ana.id } })).toBe(0);
    expect(await prisma.projectLike.count({ where: { userId: ana.id } })).toBe(0);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: game.id } });
    expect(p.deletedAt).not.toBeNull();
    expect(p.visibility).toBe('private');
    await http().get(`${V}/showcase/${game.slug}`).expect(404);
    await http().get(`${V}/creators/ana-builds`).expect(404);
    // Ben's own project and data are untouched.
    await http().get(`${V}/showcase/${benGame.slug}`).expect(200);

    // The old token no longer works, and nothing re-creates the account.
    await as(ana).get('/me').expect(403);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'account.deleted' } });
    expect(JSON.stringify(audit.metadata)).not.toContain(ana.email);
  });

  it('refuses while the person is the only owner of a team with other members, and leaves other teams cleanly', async () => {
    const ana = await person('ana');
    const ben = await person('ben');
    const team = await prisma.organization.create({ data: { name: 'Studio', slug: `studio-${ana.id.slice(0, 6)}`, memberships: { create: [{ userId: ana.id, role: 'owner' }, { userId: ben.id, role: 'member' }] } } });
    const other = await prisma.organization.create({ data: { name: 'Agency', slug: `agency-${ana.id.slice(0, 6)}`, memberships: { create: [{ userId: ben.id, role: 'owner' }, { userId: ana.id, role: 'admin' }] } } });

    const preview = (await as(ana).get('/me/deletion').expect(200)).body;
    expect(preview.blockers[0]).toContain('only owner of "Studio"');
    const refused = await as(ana).del('/me', { confirmEmail: ana.email }).expect(409);
    expect(refused.body.message).toContain('Studio');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ana.id } })).status).toBe('active');
    expect(calls).toHaveLength(0);

    await prisma.organizationMembership.updateMany({ where: { organizationId: team.id, userId: ben.id }, data: { role: 'owner' } });
    const res = (await as(ana).del('/me', { confirmEmail: ana.email }).expect(200)).body;
    expect(res.workspacesClosed).toBe(1); // personal only: Studio and Agency carry on with Ben
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: team.id } })).name).toBe('Studio');
    expect(await prisma.organizationMembership.count({ where: { organizationId: other.id } })).toBe(1);
  });

  it('takes votes back out of challenge totals and still finishes when Supabase cannot remove the sign-in', async () => {
    const admin = await person('admin');
    await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'admin' } });
    const ben = await person('ben');
    const ana = await person('ana');
    await prisma.user.update({ where: { id: ana.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    const now = Date.now();
    await as(admin).post('/admin/challenges', {
      slug: 'arcade-week', title: 'Arcade week', brief: 'Build a one-screen arcade game anyone can play.', projectTypes: ['game'],
      startsAt: new Date(now - 3600_000).toISOString(), submissionsCloseAt: new Date(now + 86_400_000).toISOString(), votingClosesAt: new Date(now + 2 * 86_400_000).toISOString(), status: 'published',
    }).expect(201);
    const benGame = await publishedGame(ben, 'Ben game');
    const entry = (await as(ben).post('/challenges/arcade-week/entries', { projectId: benGame.id, note: '' }).expect(201)).body.entries[0];
    await as(ana).put(`/challenges/arcade-week/entries/${entry.id}/vote`).expect(200);
    expect((await prisma.challengeEntry.findUniqueOrThrow({ where: { id: entry.id } })).voteCount).toBe(1);

    supabaseStatus = 500;
    const res = (await as(ana).del('/me', { confirmEmail: ana.email }).expect(200)).body;
    expect(res.signInRemoved).toBe(false);
    expect((await prisma.challengeEntry.findUniqueOrThrow({ where: { id: entry.id } })).voteCount).toBe(0);
    expect(await prisma.challengeVote.count()).toBe(0);
    await as(ana).get('/me').expect(403);
  });
});
