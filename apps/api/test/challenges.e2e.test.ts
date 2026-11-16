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
const H = 3600_000;
beforeAll(async () => ({ app, prisma } = await createTestApp({ env: { TRUST_PROXY: '1' } })));
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma); });

type P = { id: string; email: string; auth: string; orgId: string };
const seq = { n: 0 };
/** A signed-in person. `ageDays` backdates the account so it may vote. */
async function person(label: string, ageDays = 3): Promise<P> {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = (await http().get(`${V}/me`).set('Authorization', auth).expect(200)).body;
  await prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date(Date.now() - ageDays * 24 * H) } });
  return { ...u, auth, orgId: me.personalOrgId };
}
const as = (p: P) => {
  const ip = `10.8.${seq.n++ % 250}.${(parseInt(p.id.slice(0, 2), 16) % 250) + 1}`;
  const h = (r: request.Test) => r.set('Authorization', p.auth).set('x-forwarded-for', ip);
  return { get: (u: string) => h(http().get(`${V}${u}`)), post: (u: string, b: object = {}) => h(http().post(`${V}${u}`).send(b)), put: (u: string, b: object = {}) => h(http().put(`${V}${u}`).send(b)), patch: (u: string, b: object) => h(http().patch(`${V}${u}`).send(b)), del: (u: string) => h(http().delete(`${V}${u}`)) };
};
async function project(owner: P, title: string, type: 'website' | 'game' = 'game', publish = true) {
  const id = (await as(owner).post('/projects', { name: title, type }).expect(201)).body.id as string;
  const p = await prisma.project.findUniqueOrThrow({ where: { id } });
  await app.get(GenerationsService).importTree(p, new Map([['index.html', '<!doctype html><title>x</title><h1>Hi</h1>']]), 'seed');
  if (publish) await as(owner).put(`/projects/${id}/publishing`, { visibility: 'public', publicTitle: title }).expect(200);
  return id;
}
async function admin() {
  const a = await person('admin');
  await prisma.user.update({ where: { id: a.id }, data: { platformRole: 'admin' } });
  return a;
}
async function challenge(a: P, over: Record<string, unknown> = {}) {
  const now = Date.now();
  return (await as(a).post('/admin/challenges', {
    slug: 'arcade-week', title: 'Arcade week', brief: 'Build a one-screen arcade game anyone can play in a minute.', projectTypes: ['game'], prize: '3 months of Creator',
    startsAt: new Date(now - H).toISOString(), submissionsCloseAt: new Date(now + 48 * H).toISOString(), votingClosesAt: new Date(now + 72 * H).toISOString(), status: 'published', ...over,
  }).expect(201)).body;
}

describe('challenges', () => {
  it('owner creates a challenge; drafts stay hidden; only admins manage it', async () => {
    const a = await admin();
    const customer = await person('customer');
    await as(customer).post('/admin/challenges', { slug: 'x' }).expect(404);
    await as(a).post('/admin/challenges', { slug: 'bad-dates', title: 'Bad dates', brief: 'Dates that make no sense at all here.', startsAt: new Date().toISOString(), submissionsCloseAt: new Date(Date.now() - H).toISOString(), votingClosesAt: new Date().toISOString() }).expect(400);
    const draft = await challenge(a, { status: 'draft' });
    expect(draft.phase).toBe('draft');
    await http().get(`${V}/challenges/arcade-week`).expect(404);
    expect((await http().get(`${V}/challenges`).expect(200)).body).toMatchObject({ enabled: true, current: [] });
    await as(a).post('/admin/challenges', { slug: 'arcade-week', title: 'Again', brief: 'Duplicate address for the same challenge.', startsAt: new Date().toISOString(), submissionsCloseAt: new Date(Date.now() + H).toISOString(), votingClosesAt: new Date(Date.now() + H).toISOString() }).expect(409);
    await as(a).patch(`/admin/challenges/${draft.id}`, { status: 'published' }).expect(200);
    const list = (await http().get(`${V}/challenges`).expect(200)).body;
    expect(list.current).toMatchObject([{ slug: 'arcade-week', phase: 'open', prize: '3 months of Creator', entries: 0 }]);
    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: 'challenge.' } } });
    expect(audit.map((r) => r.action).sort()).toEqual(['challenge.created', 'challenge.updated']);
  });

  it('entries must be the entrant’s own published project of an allowed type, one per workspace', async () => {
    const a = await admin();
    await challenge(a);
    const maker = await person('maker'); const other = await person('other');
    await as(maker).post('/challenges/arcade-week/entries', { projectId: crypto.randomUUID() }).expect(404);
    const site = await project(maker, 'Bakery site', 'website');
    await as(maker).post('/challenges/arcade-week/entries', { projectId: site }).expect(400); // wrong type
    await prisma.project.update({ where: { id: site }, data: { deletedAt: new Date() } }); // free plan allows one active project
    const draftGame = await project(maker, 'Hidden game', 'game', false);
    await as(maker).post('/challenges/arcade-week/entries', { projectId: draftGame }).expect(400); // not published
    await as(maker).put(`/projects/${draftGame}/publishing`, { visibility: 'public', publicTitle: 'Brick Rush' }).expect(200);
    expect((await as(maker).get('/challenges/arcade-week/eligible').expect(200)).body).toMatchObject([{ id: draftGame, title: 'Brick Rush', type: 'game' }]);
    await as(other).post('/challenges/arcade-week/entries', { projectId: draftGame }).expect(404); // someone else's project
    const d = (await as(maker).post('/challenges/arcade-week/entries', { projectId: draftGame, note: 'Made in an evening' }).expect(201)).body;
    expect(d.entries).toMatchObject([{ rank: 1, votes: 0, mine: true, note: 'Made in an evening', project: { title: 'Brick Rush', type: 'game' } }]);
    expect(d.myEntry).toBe(d.entries[0].id);
    await as(maker).post('/challenges/arcade-week/entries', { projectId: draftGame }).expect(409);
    expect((await as(maker).get('/challenges/arcade-week/eligible').expect(200)).body).toEqual([]);
    // Withdraw while open, then the project is eligible again.
    await as(other).del(`/challenges/arcade-week/entries/${d.myEntry}`).expect(404);
    await as(maker).del(`/challenges/arcade-week/entries/${d.myEntry}`).expect(200);
    expect((await http().get(`${V}/challenges/arcade-week`).expect(200)).body.entries).toEqual([]);
  });

  it('voting: limited per person, never for your own entry, not from brand-new accounts, ranked with ties, winners after it ends', async () => {
    const a = await admin();
    const c = await challenge(a, { votesPerUser: 2 });
    const makers = await Promise.all(['ana', 'ben', 'cy'].map((n) => person(n)));
    const ids: string[] = [];
    for (const [i, m] of makers.entries()) {
      const pid = await project(m, `Game ${i + 1}`);
      const d = (await as(m).post('/challenges/arcade-week/entries', { projectId: pid }).expect(201)).body;
      ids.push(d.myEntry);
    }
    const [ana, ben, cy] = makers as [P, P, P];
    const voters = await Promise.all(['v1', 'v2', 'v3'].map((n) => person(n)));
    const fresh = await person('fresh', 0);
    await http().put(`${V}/challenges/arcade-week/entries/${ids[0]}/vote`).expect(401);
    await as(ana).put(`/challenges/arcade-week/entries/${ids[0]}/vote`).expect(403); // own entry
    await as(fresh).put(`/challenges/arcade-week/entries/${ids[0]}/vote`).expect(403); // account too new

    // ana's game: 4 votes; ben's: 2; cy's: 0.
    for (const v of [...voters, cy]) await as(v).put(`/challenges/arcade-week/entries/${ids[0]}/vote`).expect(200);
    await as(voters[0]!).put(`/challenges/arcade-week/entries/${ids[1]}/vote`).expect(200);
    const third = await as(voters[0]!).put(`/challenges/arcade-week/entries/${ids[2]}/vote`).expect(409); // limit 2
    expect(third.body.message).toContain('all 2 of your votes');
    await as(voters[0]!).put(`/challenges/arcade-week/entries/${ids[1]}/vote`).expect(200); // voting twice changes nothing
    await as(ana).put(`/challenges/arcade-week/entries/${ids[1]}/vote`).expect(200);
    // Concurrent clicks can't beat the limit.
    const burst = await Promise.all(ids.slice(1).map((id) => as(voters[1]!).put(`/challenges/arcade-week/entries/${id}/vote`)));
    expect(burst.map((r) => r.status).sort()).toEqual([200, 409]);
    await as(voters[1]!).del(`/challenges/arcade-week/entries/${ids[1]}/vote`).expect(200);
    await as(voters[1]!).del(`/challenges/arcade-week/entries/${ids[2]}/vote`).expect(200);

    const view = (await as(voters[0]!).get('/challenges/arcade-week').expect(200)).body;
    expect(view.entries.map((e: { votes: number; rank: number; votedByMe: boolean }) => [e.votes, e.rank, e.votedByMe])).toEqual([[4, 1, true], [2, 2, true], [0, 3, false]]);
    expect(view.myVotesLeft).toBe(0);
    expect(view.entries.every((e: { winner: boolean }) => !e.winner)).toBe(true);
    const counted = await prisma.challengeVote.count();
    expect(counted).toBe(6);

    // A moderated (hidden) entry drops out of the ranking and can't be voted for.
    await as(a).post(`/admin/challenges/entries/${ids[2]}/hide`, { note: 'Not an original game' }).expect(200);
    expect((await http().get(`${V}/challenges/arcade-week`).expect(200)).body.entries).toHaveLength(2);
    await as(voters[2]!).put(`/challenges/arcade-week/entries/${ids[2]}/vote`).expect(404);
    // An entry whose project is unpublished drops out too.
    await as(ben).put(`/projects/${(await prisma.challengeEntry.findUniqueOrThrow({ where: { id: ids[1] } })).projectId}/publishing`, { visibility: 'private' }).expect(200);
    expect((await http().get(`${V}/challenges/arcade-week`).expect(200)).body.entries).toHaveLength(1);
    await as(ben).put(`/projects/${(await prisma.challengeEntry.findUniqueOrThrow({ where: { id: ids[1] } })).projectId}/publishing`, { visibility: 'public' }).expect(200);

    // After voting closes: winners, no more votes, no new entries, and ana gets the badges.
    await prisma.challenge.update({ where: { slug: 'arcade-week' }, data: { startsAt: new Date(Date.now() - 96 * H), submissionsCloseAt: new Date(Date.now() - 48 * H), votingClosesAt: new Date(Date.now() - H) } });
    const ended = (await http().get(`${V}/challenges/arcade-week`).expect(200)).body;
    expect(ended.phase).toBe('ended');
    expect(ended.entries.map((e: { winner: boolean; votes: number }) => [e.votes, e.winner])).toEqual([[4, true], [2, true]]);
    await as(voters[2]!).put(`/challenges/arcade-week/entries/${ids[1]}/vote`).expect(400);
    expect((await http().get(`${V}/challenges`).expect(200)).body.past).toMatchObject([{ slug: c.slug, phase: 'ended', entries: 2 }]);
    const badges = (await as(ana).get('/me/achievements').expect(200)).body.badges as { key: string; earnedAt: string | null }[];
    expect(badges.find((b) => b.key === 'challenge_entrant')?.earnedAt).toBeTruthy();
    expect(badges.find((b) => b.key === 'challenge_podium')?.earnedAt).toBeTruthy();
    const cyBadges = (await as(cy).get('/me/achievements').expect(200)).body.badges as { key: string; earnedAt: string | null }[];
    expect(cyBadges.find((b) => b.key === 'challenge_podium')?.earnedAt).toBeNull(); // hidden entry, no votes

    // Creator leaderboard: likes and remixes from others in 30 days, plus podiums.
    const board = (await http().get(`${V}/leaderboards/creators`).expect(200)).body as { handle: string; podiums: number; score: number }[];
    expect(board.length).toBeGreaterThanOrEqual(2);
    expect(board[0]).toMatchObject({ rank: 1, podiums: 1, score: 10 });
  });

  it('the challenges flag switches it all off', async () => {
    const a = await admin();
    await challenge(a);
    await as(a).patch('/admin/flags/challenges', { enabled: false }).expect(200);
    expect((await http().get(`${V}/challenges`).expect(200)).body).toMatchObject({ enabled: false, current: [] });
    expect((await http().get(`${V}/challenges/arcade-week`).expect(503)).body.code).toBe('feature_disabled');
  });
});
