import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Challenge, type PrismaClient } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { FlagsService } from '../flags/flags.service.js';
import { cardSelect, publicWhere, toCard } from './showcase.service.js';

const TYPES = ['mobile_app', 'website', 'ecommerce', 'business_website', 'saas', 'custom_software', 'game'] as const;
const DAY = 86_400_000;
/** People whose account is younger than this when voting closes can't vote: a brake on throwaway accounts. */
const MIN_ACCOUNT_AGE_MS = DAY;

export const ChallengeSchema = z
  .object({
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/, 'Use 3–60 lowercase letters, numbers or hyphens.'),
    title: z.string().trim().min(3).max(80),
    brief: z.string().trim().min(20).max(2000),
    projectTypes: z.array(z.enum(TYPES)).max(TYPES.length).default([]),
    prize: z.string().trim().max(200).nullable().default(null),
    startsAt: z.coerce.date(),
    submissionsCloseAt: z.coerce.date(),
    votingClosesAt: z.coerce.date(),
    votesPerUser: z.number().int().min(1).max(10).default(3),
    status: z.enum(['draft', 'published', 'cancelled']).default('draft'),
  })
  .refine((c) => c.submissionsCloseAt > c.startsAt, { message: 'Submissions must close after the challenge starts.', path: ['submissionsCloseAt'] })
  .refine((c) => c.votingClosesAt >= c.submissionsCloseAt, { message: 'Voting must close on or after submissions close.', path: ['votingClosesAt'] });
export type ChallengeInput = z.infer<typeof ChallengeSchema>;
export const ChallengePatchSchema = z.object({
  title: z.string().trim().min(3).max(80).optional(),
  brief: z.string().trim().min(20).max(2000).optional(),
  projectTypes: z.array(z.enum(TYPES)).max(TYPES.length).optional(),
  prize: z.string().trim().max(200).nullable().optional(),
  startsAt: z.coerce.date().optional(),
  submissionsCloseAt: z.coerce.date().optional(),
  votingClosesAt: z.coerce.date().optional(),
  votesPerUser: z.number().int().min(1).max(10).optional(),
  status: z.enum(['draft', 'published', 'cancelled']).optional(),
});
export const EntrySchema = z.object({ projectId: z.uuid(), note: z.string().trim().max(300).default('') });

export type ChallengePhase = 'upcoming' | 'open' | 'voting' | 'ended' | 'cancelled' | 'draft';

export function phaseOf(c: Pick<Challenge, 'status' | 'startsAt' | 'submissionsCloseAt' | 'votingClosesAt'>, now = new Date()): ChallengePhase {
  if (c.status === 'draft') return 'draft';
  if (c.status === 'cancelled') return 'cancelled';
  if (now < c.startsAt) return 'upcoming';
  if (now < c.submissionsCloseAt) return 'open';
  if (now < c.votingClosesAt) return 'voting';
  return 'ended';
}

/** Entries that count: not hidden, and the project is still public, published and not moderated. */
const liveEntry = (challengeId: string): Prisma.ChallengeEntryWhereInput => ({ challengeId, hiddenAt: null, project: publicWhere });

/**
 * Weekly building challenges. The owner writes the brief and the dates; creators enter a project they have
 * already published; signed-in people vote for a few favourites (never their own workspace's entry); the ranking
 * is by votes, and the top three of an ended challenge are its winners. Every number comes from stored rows.
 */
@Injectable()
export class ChallengesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  private summary(c: Challenge & { _count?: { entries: number } }, entryCount?: number) {
    return {
      slug: c.slug, title: c.title, brief: c.brief, projectTypes: c.projectTypes, prize: c.prize,
      startsAt: c.startsAt.toISOString(), submissionsCloseAt: c.submissionsCloseAt.toISOString(), votingClosesAt: c.votingClosesAt.toISOString(),
      votesPerUser: c.votesPerUser, phase: phaseOf(c), entries: entryCount ?? c._count?.entries ?? 0,
    };
  }

  // ───────── Public ─────────

  async list() {
    if (!(await this.flags.isEnabled('challenges'))) return { enabled: false, current: [], upcoming: [], past: [] };
    const rows = await this.prisma.challenge.findMany({ where: { status: 'published' }, orderBy: { startsAt: 'desc' }, take: 60 });
    const counts = await this.prisma.challengeEntry.groupBy({ by: ['challengeId'], where: { challengeId: { in: rows.map((r) => r.id) }, hiddenAt: null, project: publicWhere }, _count: { _all: true } });
    const n = new Map(counts.map((c) => [c.challengeId, c._count._all]));
    const all = rows.map((r) => this.summary(r, n.get(r.id) ?? 0));
    return {
      enabled: true,
      current: all.filter((c) => c.phase === 'open' || c.phase === 'voting').reverse(),
      upcoming: all.filter((c) => c.phase === 'upcoming').reverse(),
      past: all.filter((c) => c.phase === 'ended').slice(0, 20),
    };
  }

  private async findPublic(slug: string) {
    await this.flags.assert('challenges', 'Challenges');
    const c = await this.prisma.challenge.findUnique({ where: { slug } });
    if (!c || c.status === 'draft') throw new NotFoundException('Challenge not found');
    return c;
  }

  /** The challenge with its ranked entries. Signed-in viewers also get their votes and which of their projects can enter. */
  async detail(slug: string, viewer: AuthUser | null) {
    const c = await this.findPublic(slug);
    const phase = phaseOf(c);
    const entries = await this.prisma.challengeEntry.findMany({
      where: liveEntry(c.id),
      orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }],
      take: 200,
      include: { project: { select: cardSelect } },
    });
    let myVotes: string[] = [];
    let myOrgIds: string[] = [];
    if (viewer) {
      myVotes = (await this.prisma.challengeVote.findMany({ where: { challengeId: c.id, userId: viewer.id }, select: { entryId: true } })).map((v) => v.entryId);
      myOrgIds = (await this.orgs.listForUser(viewer.id)).map((m) => m.organization.id);
    }
    // Rank with ties sharing a place; only ended challenges with at least one vote have winners.
    let place = 0;
    let prev = -1;
    const ranked = entries.map((e, i) => {
      if (e.voteCount !== prev) { place = i + 1; prev = e.voteCount; }
      return {
        id: e.id, rank: place, votes: e.voteCount, note: e.note, submittedAt: e.createdAt.toISOString(),
        winner: phase === 'ended' && place <= 3 && e.voteCount > 0,
        mine: myOrgIds.includes(e.organizationId), votedByMe: myVotes.includes(e.id),
        project: toCard(e.project),
      };
    });
    return { ...this.summary(c, entries.length), phase, entries: ranked, myVotesLeft: viewer ? Math.max(0, c.votesPerUser - myVotes.length) : null, myEntry: ranked.find((e) => e.mine)?.id ?? null };
  }

  /** The viewer's published projects that may enter this challenge. */
  async eligible(slug: string, user: AuthUser) {
    const c = await this.findPublic(slug);
    const orgs = (await this.orgs.listForUser(user.id)).filter((m) => ['owner', 'admin', 'member'].includes(m.role)).map((m) => m.organization.id);
    const taken = new Set((await this.prisma.challengeEntry.findMany({ where: { challengeId: c.id, organizationId: { in: orgs } }, select: { organizationId: true } })).map((e) => e.organizationId));
    const projects = await this.prisma.project.findMany({
      where: { ...publicWhere, organizationId: { in: orgs.filter((o) => !taken.has(o)) }, ...(c.projectTypes.length ? { type: { in: c.projectTypes } } : {}) },
      orderBy: { publishedAt: 'desc' }, take: 50, select: { id: true, organizationId: true, type: true, publicTitle: true, name: true, slug: true },
    });
    return projects.map((p) => ({ id: p.id, title: p.publicTitle ?? p.name, slug: p.slug, type: p.type }));
  }

  async enter(slug: string, user: AuthUser, input: z.infer<typeof EntrySchema>) {
    const c = await this.findPublic(slug);
    if (phaseOf(c) !== 'open') throw new BadRequestException(phaseOf(c) === 'upcoming' ? "This challenge hasn't opened for entries yet." : 'Entries for this challenge are closed.');
    const p = await this.prisma.project.findFirst({ where: { id: input.projectId, deletedAt: null } });
    if (!p) throw new NotFoundException('Project not found');
    await this.orgs.assertRole(user.id, p.organizationId, 'member');
    if (p.visibility !== 'public' || !p.publishedVersionId || p.moderatedAt) throw new BadRequestException('Publish the project first: entries must be public so people can see and vote on them.');
    if (c.projectTypes.length && !c.projectTypes.includes(p.type)) throw new BadRequestException('This project type is not part of this challenge.');
    try {
      const e = await this.prisma.challengeEntry.create({ data: { challengeId: c.id, projectId: p.id, organizationId: p.organizationId, submittedById: user.id, note: input.note } });
      await this.audit.record({ action: 'challenge.entered', actorId: user.id, organizationId: p.organizationId, targetType: 'challenge_entry', targetId: e.id, metadata: { challenge: c.slug, projectId: p.id } });
      return this.detail(slug, user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('This workspace already has an entry in this challenge. Withdraw it first to enter a different project.');
      throw err;
    }
  }

  async withdraw(slug: string, user: AuthUser, entryId: string) {
    const c = await this.findPublic(slug);
    const e = await this.prisma.challengeEntry.findFirst({ where: { id: entryId, challengeId: c.id } });
    if (!e) throw new NotFoundException('Entry not found');
    await this.orgs.assertRole(user.id, e.organizationId, 'member');
    if (phaseOf(c) !== 'open') throw new BadRequestException('Entries can only be withdrawn while the challenge is open for entries.');
    await this.prisma.challengeEntry.delete({ where: { id: e.id } });
    await this.audit.record({ action: 'challenge.withdrawn', actorId: user.id, organizationId: e.organizationId, targetType: 'challenge_entry', targetId: e.id, metadata: { challenge: c.slug } });
    return this.detail(slug, user);
  }

  async vote(slug: string, user: AuthUser, entryId: string, on: boolean) {
    const c = await this.findPublic(slug);
    const phase = phaseOf(c);
    if (phase !== 'open' && phase !== 'voting') throw new BadRequestException(phase === 'ended' ? 'Voting has closed.' : 'Voting has not started yet.');
    const e = await this.prisma.challengeEntry.findFirst({ where: { id: entryId, ...liveEntry(c.id) } });
    if (!e) throw new NotFoundException('Entry not found');
    if (on) {
      const me = await this.prisma.user.findUnique({ where: { id: user.id }, select: { createdAt: true } });
      if (!me || Date.now() - me.createdAt.getTime() < MIN_ACCOUNT_AGE_MS) throw new ForbiddenException('New accounts can vote one day after signing up.');
      const mine = (await this.orgs.listForUser(user.id)).some((m) => m.organization.id === e.organizationId);
      if (mine) throw new ForbiddenException("You can't vote for your own workspace's entry.");
    }
    await this.prisma.$transaction(async (tx) => {
      // Serialise one person's votes in this challenge so the per-person limit holds under concurrent clicks.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vote:${c.id}:${user.id}`}))`;
      const existing = await tx.challengeVote.findUnique({ where: { entryId_userId: { entryId: e.id, userId: user.id } } });
      if (on) {
        if (existing) return;
        const used = await tx.challengeVote.count({ where: { challengeId: c.id, userId: user.id } });
        if (used >= c.votesPerUser) throw new ConflictException(`You've used all ${c.votesPerUser} of your votes in this challenge. Remove one to vote for another entry.`);
        await tx.challengeVote.create({ data: { entryId: e.id, userId: user.id, challengeId: c.id } });
        await tx.challengeEntry.update({ where: { id: e.id }, data: { voteCount: { increment: 1 } } });
      } else {
        if (!existing) return;
        await tx.challengeVote.delete({ where: { entryId_userId: { entryId: e.id, userId: user.id } } });
        await tx.challengeEntry.update({ where: { id: e.id }, data: { voteCount: { decrement: 1 } } });
      }
    });
    return this.detail(slug, user);
  }

  /** Creators ranked by what the community did with their public work in the last 30 days. */
  async creatorLeaderboard() {
    const since = new Date(Date.now() - 30 * DAY);
    const rows = await this.prisma.$queryRaw<{ userId: string; handle: string; name: string | null; likes: bigint; remixes: bigint; podiums: bigint }[]>`
      WITH likes AS (
        SELECT p."createdById" AS uid, count(*) AS n FROM "ProjectLike" l JOIN "Project" p ON p.id = l."projectId"
        WHERE l."createdAt" >= ${since} AND l."userId" <> p."createdById" AND p.visibility = 'public' AND p."deletedAt" IS NULL AND p."moderatedAt" IS NULL
        GROUP BY 1),
      remixes AS (
        SELECT src."createdById" AS uid, count(*) AS n FROM "Project" r JOIN "Project" src ON src.id = r."remixedFromId"
        WHERE r."createdAt" >= ${since} AND r."createdById" <> src."createdById" GROUP BY 1),
      podiums AS (
        SELECT p."createdById" AS uid, count(*) AS n FROM (
          SELECT e."projectId", e."voteCount", rank() OVER (PARTITION BY e."challengeId" ORDER BY e."voteCount" DESC) AS rk
          FROM "ChallengeEntry" e JOIN "Challenge" c ON c.id = e."challengeId"
          WHERE c.status = 'published' AND c."votingClosesAt" >= ${since} AND c."votingClosesAt" <= now() AND e."hiddenAt" IS NULL) w
        JOIN "Project" p ON p.id = w."projectId" WHERE w.rk <= 3 AND w."voteCount" > 0 GROUP BY 1)
      SELECT u.id AS "userId", u.handle, u."displayName" AS name, coalesce(l.n, 0) AS likes, coalesce(r.n, 0) AS remixes, coalesce(w.n, 0) AS podiums
      FROM "User" u LEFT JOIN likes l ON l.uid = u.id LEFT JOIN remixes r ON r.uid = u.id LEFT JOIN podiums w ON w.uid = u.id
      WHERE u.handle IS NOT NULL AND u.status = 'active' AND (l.n IS NOT NULL OR r.n IS NOT NULL OR w.n IS NOT NULL)`;
    return rows
      .map((r) => {
        const likes = Number(r.likes), remixes = Number(r.remixes), podiums = Number(r.podiums);
        return { handle: r.handle, name: r.name ?? r.handle, likes, remixes, podiums, score: likes + remixes * 3 + podiums * 10 };
      })
      .sort((a, b) => b.score - a.score || b.likes - a.likes || a.handle.localeCompare(b.handle))
      .slice(0, 25)
      .map((r, i) => ({ rank: i + 1, ...r }));
  }

  // ───────── Owner ─────────

  async adminList() {
    const rows = await this.prisma.challenge.findMany({ orderBy: { startsAt: 'desc' }, take: 100, include: { _count: { select: { entries: true } } } });
    return rows.map((r) => ({ id: r.id, status: r.status, ...this.summary(r) }));
  }

  async create(user: AuthUser, input: ChallengeInput) {
    try {
      const c = await this.prisma.challenge.create({ data: { ...input, createdById: user.id } });
      await this.audit.record({ action: 'challenge.created', actorId: user.id, targetType: 'challenge', targetId: c.id, metadata: { slug: c.slug, status: c.status } });
      return { id: c.id, status: c.status, ...this.summary(c, 0) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('A challenge with that address already exists.');
      throw err;
    }
  }

  async update(user: AuthUser, id: string, patch: z.infer<typeof ChallengePatchSchema>) {
    const c = await this.prisma.challenge.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Challenge not found');
    const next = { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Challenge;
    if (next.submissionsCloseAt <= next.startsAt) throw new BadRequestException('Submissions must close after the challenge starts.');
    if (next.votingClosesAt < next.submissionsCloseAt) throw new BadRequestException('Voting must close on or after submissions close.');
    const u = await this.prisma.challenge.update({ where: { id }, data: patch });
    await this.audit.record({ action: 'challenge.updated', actorId: user.id, targetType: 'challenge', targetId: id, metadata: { fields: Object.keys(patch) } });
    return { id: u.id, status: u.status, ...this.summary(u) };
  }

  async adminEntries(id: string) {
    const rows = await this.prisma.challengeEntry.findMany({ where: { challengeId: id }, orderBy: [{ voteCount: 'desc' }, { createdAt: 'asc' }], include: { project: { select: cardSelect } } });
    return rows.map((e) => ({ id: e.id, votes: e.voteCount, hidden: !!e.hiddenAt, hiddenNote: e.hiddenNote, note: e.note, submittedAt: e.createdAt.toISOString(), project: e.project.slug ? toCard(e.project) : null }));
  }

  async moderateEntry(user: AuthUser, entryId: string, hide: boolean, note?: string) {
    const e = await this.prisma.challengeEntry.findUnique({ where: { id: entryId } });
    if (!e) throw new NotFoundException('Entry not found');
    await this.prisma.challengeEntry.update({ where: { id: entryId }, data: hide ? { hiddenAt: new Date(), hiddenNote: note ?? null } : { hiddenAt: null, hiddenNote: null } });
    await this.audit.record({ action: hide ? 'challenge.entry_hidden' : 'challenge.entry_restored', actorId: user.id, targetType: 'challenge_entry', targetId: entryId, metadata: { note } });
    return { ok: true };
  }
}
