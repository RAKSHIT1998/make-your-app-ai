import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());
const V = '/api/v1';

beforeAll(async () => ({ app, prisma } = await createTestApp({ env: { WEB_APP_URL: 'https://app.example.test', TRUST_PROXY: '1' } })));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb(prisma);
  // Free plan in tests: up to 3 workspaces, 3 seats per workspace.
  await prisma.plan.update({ where: { code: 'free' }, data: { maxOrgs: 3, maxSeats: 3 } });
});

async function person(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = (await http().get(`${V}/me`).set('Authorization', auth).set('x-forwarded-for', '10.250.0.1').expect(200)).body;
  return { ...u, auth, orgId: me.personalOrgId as string };
}
type P = Awaited<ReturnType<typeof person>>;
// Each person is a distinct client IP so the per-route limits don't see the whole suite as one caller.
const ip = (p: P) => `10.${parseInt(p.id.slice(0, 2), 16)}.${parseInt(p.id.slice(2, 4), 16)}.${parseInt(p.id.slice(4, 6), 16) || 1}`;
const as = (p: P) => ({ get: (u: string) => http().get(`${V}${u}`).set('Authorization', p.auth).set('x-forwarded-for', ip(p)), post: (u: string, b: object = {}) => http().post(`${V}${u}`).set('Authorization', p.auth).set('x-forwarded-for', ip(p)).send(b), patch: (u: string, b: object) => http().patch(`${V}${u}`).set('Authorization', p.auth).set('x-forwarded-for', ip(p)).send(b), del: (u: string) => http().delete(`${V}${u}`).set('Authorization', p.auth).set('x-forwarded-for', ip(p)) });
const tokenOf = (link: string) => link.split('/').pop()!;

async function team(owner: P, name = 'Studio Team') {
  return (await as(owner).post('/orgs', { name }).expect(201)).body as { id: string };
}
async function join(owner: P, orgId: string, who: P, role: 'admin' | 'member' | 'viewer' = 'member') {
  const inv = (await as(owner).post(`/orgs/${orgId}/invitations`, { email: who.email, role }).expect(201)).body;
  await as(who).post(`/invitations/${tokenOf(inv.link)}/accept`).expect(200);
}

describe('workspaces', () => {
  it('are limited by the plan, start on their own Free entitlement, and appear in /me', async () => {
    const owner = await person('owner');
    await prisma.plan.update({ where: { code: 'free' }, data: { maxOrgs: 1 } });
    const refused = await as(owner).post('/orgs', { name: 'Nope' }).expect(402);
    expect(refused.body.code).toBe('plan_limit_workspaces');
    await prisma.plan.update({ where: { code: 'free' }, data: { maxOrgs: 3 } });
    const t1 = await team(owner, 'Acme Agency');
    await team(owner, 'Second');
    await as(owner).post('/orgs', { name: 'Third' }).expect(402); // personal + 2 teams = 3
    const me = (await as(owner).get('/me').expect(200)).body;
    expect(me.organizations).toEqual(expect.arrayContaining([expect.objectContaining({ id: t1.id, name: 'Acme Agency', role: 'owner', personal: false })]));
    const t = (await as(owner).get(`/orgs/${t1.id}/team`).expect(200)).body;
    expect(t).toMatchObject({ personal: false, role: 'owner', canInvite: true, seats: { used: 1, pending: 0, limit: 3 } });
    expect((await as(owner).get(`/orgs/${owner.orgId}/team`).expect(200)).body).toMatchObject({ personal: true, canInvite: false });
    await as(owner).patch(`/orgs/${t1.id}`, { name: 'Acme Studio' }).expect(200);
    await as(owner).patch(`/orgs/${owner.orgId}`, { name: 'x y' }).expect(400);
    expect(await prisma.auditLog.count({ where: { organizationId: t1.id, action: { in: ['workspace.created', 'workspace.renamed'] } } })).toBe(2);
  });
});

describe('invitations', () => {
  it('invite → preview → accept: only the invited email can join, links are single-use and stored hashed', async () => {
    const owner = await person('owner');
    const bob = await person('bob');
    const carol = await person('carol');
    const t = await team(owner);
    const inv = (await as(owner).post(`/orgs/${t.id}/invitations`, { email: ` ${bob.email.toUpperCase()} `, role: 'member' }).expect(201)).body;
    expect(inv).toMatchObject({ email: bob.email.toLowerCase(), role: 'member', link: expect.stringMatching(/^https:\/\/app\.example\.test\/invite\/team\/[A-Za-z0-9_-]{32,}$/) });
    const token = tokenOf(inv.link);
    // Only a hash is stored.
    const row = await prisma.organizationInvitation.findFirstOrThrow({ where: { organizationId: t.id } });
    expect(row.tokenHash).not.toContain(token);
    expect(JSON.stringify(await as(owner).get(`/orgs/${t.id}/invitations`).expect(200).then((r) => r.body))).not.toContain(token);
    // Public preview shows the workspace and a masked email, never the full address.
    const pv = (await http().get(`${V}/invitations/${token}`).expect(200)).body;
    expect(pv).toMatchObject({ organizationName: 'Studio Team', role: 'member' });
    expect(JSON.stringify(pv)).not.toContain(bob.email);
    await http().get(`${V}/invitations/${'a'.repeat(40)}`).expect(404);
    await http().get(`${V}/invitations/short`).expect(400);
    // Someone else with the link can't use it; nor can a signed-out caller.
    await as(carol).post(`/invitations/${token}/accept`).expect(403);
    await http().post(`${V}/invitations/${token}/accept`).expect(401);
    expect((await as(bob).post(`/invitations/${token}/accept`).expect(200)).body).toMatchObject({ organizationId: t.id, role: 'member' });
    await as(bob).post(`/invitations/${token}/accept`).expect(404); // single use
    expect((await as(bob).get(`/orgs/${t.id}/members`).expect(200)).body.map((m: { email: string }) => m.email).sort()).toEqual([bob.email, owner.email].sort());
    expect((await as(owner).get(`/orgs/${t.id}/team`).expect(200)).body.seats).toMatchObject({ used: 2, pending: 0 });
    expect(await prisma.auditLog.count({ where: { organizationId: t.id, action: { in: ['workspace.invited', 'workspace.joined'] } } })).toBe(2);
  });

  it('re-inviting replaces the old link; revoking and expiry kill it; already-members are refused', async () => {
    const owner = await person('owner');
    const bob = await person('bob');
    const t = await team(owner);
    const first = tokenOf((await as(owner).post(`/orgs/${t.id}/invitations`, { email: bob.email }).expect(201)).body.link);
    const second = (await as(owner).post(`/orgs/${t.id}/invitations`, { email: bob.email, role: 'viewer' }).expect(201)).body;
    await http().get(`${V}/invitations/${first}`).expect(404);
    expect((await as(owner).get(`/orgs/${t.id}/invitations`).expect(200)).body).toHaveLength(1);
    await as(owner).del(`/orgs/${t.id}/invitations/${second.id}`).expect(204);
    await as(bob).post(`/invitations/${tokenOf(second.link)}/accept`).expect(404);
    const third = (await as(owner).post(`/orgs/${t.id}/invitations`, { email: bob.email }).expect(201)).body;
    await prisma.organizationInvitation.update({ where: { id: third.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().get(`${V}/invitations/${tokenOf(third.link)}`).expect(410);
    await as(bob).post(`/invitations/${tokenOf(third.link)}/accept`).expect(410);
    await join(owner, t.id, bob);
    await as(owner).post(`/orgs/${t.id}/invitations`, { email: bob.email }).expect(409);
    await as(owner).post(`/orgs/${owner.orgId}/invitations`, { email: 'x@y.test' }).expect(400); // personal workspace
    await as(owner).post(`/orgs/${t.id}/invitations`, { email: 'not-an-email' }).expect(400);
  });

  it('seats come from the workspace plan and pending invitations hold a seat', async () => {
    const owner = await person('owner');
    const [bob, dave, erin] = [await person('bob'), await person('dave'), await person('erin')];
    const t = await team(owner); // 3 seats
    await join(owner, t.id, bob);
    await as(owner).post(`/orgs/${t.id}/invitations`, { email: dave.email }).expect(201); // owner + bob + pending dave = 3
    const full = await as(owner).post(`/orgs/${t.id}/invitations`, { email: erin.email }).expect(402);
    expect(full.body.code).toBe('plan_limit_seats');
    // Re-issuing dave's own invite doesn't count him twice.
    await as(owner).post(`/orgs/${t.id}/invitations`, { email: dave.email }).expect(201);
    // Downgrade between invite and accept: the seat is re-checked.
    await prisma.subscriptionEntitlement.update({ where: { organizationId: t.id }, data: { teamSeats: 2 } });
    const token = tokenOf((await as(owner).post(`/orgs/${t.id}/invitations`, { email: dave.email }).expect(402).then(async () => { await prisma.subscriptionEntitlement.update({ where: { organizationId: t.id }, data: { teamSeats: 3 } }); return as(owner).post(`/orgs/${t.id}/invitations`, { email: dave.email }).expect(201); })).body.link);
    await prisma.subscriptionEntitlement.update({ where: { organizationId: t.id }, data: { teamSeats: 2 } });
    expect((await as(dave).post(`/invitations/${token}/accept`).expect(402)).body.code).toBe('plan_limit_seats');
    expect(await prisma.organizationMembership.count({ where: { organizationId: t.id } })).toBe(2);
  });
});

describe('roles and isolation', () => {
  it('members share projects; viewers read only; outsiders see nothing', async () => {
    const owner = await person('owner');
    const [bob, vic, out] = [await person('bob'), await person('vic'), await person('out')];
    const t = await team(owner);
    await join(owner, t.id, bob, 'member');
    await join(owner, t.id, vic, 'viewer');
    const p = (await as(owner).post('/projects', { name: 'Shared site', type: 'website', organizationId: t.id }).expect(201)).body;
    expect(p.organizationId).toBe(t.id);
    // Member sees and creates; viewer sees but can't create or edit; outsider can't even tell it exists.
    expect((await as(bob).get(`/projects?organizationId=${t.id}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(p.id);
    await as(bob).post('/projects', { name: 'Bob page', type: 'website', organizationId: t.id }).expect(201);
    expect((await as(vic).get(`/projects/${p.id}`).expect(200)).body.id).toBe(p.id);
    await as(vic).post('/projects', { name: 'Nope', type: 'website', organizationId: t.id }).expect(403);
    await as(vic).patch(`/projects/${p.id}`, { name: 'Renamed' }).expect(403);
    await as(out).get(`/projects/${p.id}`).expect(404);
    await as(out).get(`/projects?organizationId=${t.id}`).expect(404);
    await as(out).get(`/orgs/${t.id}/members`).expect(404);
    await as(out).post(`/orgs/${t.id}/invitations`, { email: 'x@y.test' }).expect(404);
    // Members can't manage the team.
    await as(bob).post(`/orgs/${t.id}/invitations`, { email: 'x@y.test' }).expect(403);
    await as(bob).get(`/orgs/${t.id}/invitations`).expect(403);
    await as(vic).patch(`/orgs/${t.id}/members/${bob.id}`, { role: 'viewer' }).expect(403);
  });

  it('owner and admin powers: only the owner manages admins; the owner can never be removed; anyone can leave', async () => {
    const owner = await person('owner');
    const [adm, bob, vic] = [await person('adm'), await person('bob'), await person('vic')];
    const t = await team(owner);
    await prisma.plan.update({ where: { code: 'free' }, data: { maxSeats: 5 } });
    await prisma.subscriptionEntitlement.update({ where: { organizationId: t.id }, data: { teamSeats: 5 } });
    await join(owner, t.id, adm, 'admin');
    await join(adm, t.id, bob, 'member'); // admins invite members
    await as(adm).post(`/orgs/${t.id}/invitations`, { email: vic.email, role: 'admin' }).expect(403); // but not admins
    await join(adm, t.id, vic, 'viewer');
    // Role changes
    await as(adm).patch(`/orgs/${t.id}/members/${vic.id}`, { role: 'member' }).expect(200);
    await as(adm).patch(`/orgs/${t.id}/members/${vic.id}`, { role: 'admin' }).expect(403);
    await as(adm).patch(`/orgs/${t.id}/members/${owner.id}`, { role: 'member' }).expect(403);
    await as(adm).patch(`/orgs/${t.id}/members/${adm.id}`, { role: 'member' }).expect(400);
    await as(owner).patch(`/orgs/${t.id}/members/${vic.id}`, { role: 'admin' }).expect(200);
    await as(adm).patch(`/orgs/${t.id}/members/${vic.id}`, { role: 'viewer' }).expect(403); // vic is now an admin
    await as(owner).patch(`/orgs/${t.id}/members/${randomUuid()}`, { role: 'member' }).expect(404);
    // Removal
    await as(adm).del(`/orgs/${t.id}/members/${owner.id}`).expect(403);
    await as(adm).del(`/orgs/${t.id}/members/${vic.id}`).expect(403); // admin can't remove an admin
    await as(adm).del(`/orgs/${t.id}/members/${bob.id}`).expect(204);
    await as(bob).get(`/projects?organizationId=${t.id}`).expect(404); // access ends immediately
    await as(owner).del(`/orgs/${t.id}/members/${owner.id}`).expect(403); // owner can't leave
    await as(vic).del(`/orgs/${t.id}/members/${vic.id}`).expect(204); // anyone else can leave
    await as(owner).del(`/orgs/${owner.orgId}/members/${owner.id}`).expect(400);
    expect(await prisma.auditLog.count({ where: { organizationId: t.id, action: { in: ['workspace.member_removed', 'workspace.member_left', 'workspace.member_role_changed'] } } })).toBe(4);
  });

  it('can be switched off with the team_workspaces flag', async () => {
    const owner = await person('owner');
    const t = await team(owner);
    await prisma.platformFlag.create({ data: { key: 'team_workspaces', enabled: false } });
    await new Promise((r) => setTimeout(r, 5200)); // flags cache for 5s
    const res = await as(owner).post(`/orgs/${t.id}/invitations`, { email: 'x@y.test' });
    expect(res.status).toBe(503);
  }, 15_000);
});

const randomUuid = () => crypto.randomUUID();
