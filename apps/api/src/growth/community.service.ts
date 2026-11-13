import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { FlagsService } from '../flags/flags.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { cardSelect, publicWhere, toCard } from './showcase.service.js';

export const CommentSchema = z.object({ body: z.string().trim().min(1, 'Write something first.').max(1000), parentId: z.uuid().optional() });
export const CommentReportSchema = z.object({ reason: z.enum(['spam', 'abuse', 'harassment', 'illegal', 'other']) });
export const CollectionSchema = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default(''), isPublic: z.boolean().default(false) });
export const CollectionPatchSchema = CollectionSchema.partial();

const AUTO_HIDE_COMMENT_REPORTS = 3;
const MAX_LINKS = 2;
const COMMENTS_PER_HOUR = 10;
const MAX_COLLECTIONS = 20;
const MAX_ITEMS = 100;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

const authorSelect = { id: true, handle: true, displayName: true } as const;
const authorName = (a: { handle: string | null; displayName: string | null }) => a.displayName ?? a.handle ?? 'Member';

/** Comments, follows and collections on the public showcase. Everything here is user-generated, so it is rate limited, reportable and moderatable. */
@Injectable()
export class CommunityService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async publicProject(slug: string) {
    const p = await this.prisma.project.findFirst({ where: { slug, ...publicWhere }, select: { id: true, organizationId: true, createdById: true, commentsEnabled: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  // ───────────── Comments ─────────────

  async comments(slug: string, viewer: AuthUser | null) {
    await this.flags.assert('comments', 'Comments');
    const p = await this.publicProject(slug);
    const rows = await this.prisma.projectComment.findMany({ where: { projectId: p.id, status: 'visible' }, orderBy: { createdAt: 'asc' }, take: 300, include: { author: { select: authorSelect } } });
    const member = viewer ? await this.prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: p.organizationId, userId: viewer.id } } }) : null;
    const canModerate = !!member && (member.role === 'owner' || member.role === 'admin');
    return {
      enabled: p.commentsEnabled,
      items: rows.map((c) => ({
        id: c.id, parentId: c.parentId, body: c.body, createdAt: c.createdAt.toISOString(),
        author: { handle: c.author.handle, name: authorName(c.author) }, byCreator: c.authorId === p.createdById,
        mine: viewer?.id === c.authorId, canRemove: viewer?.id === c.authorId || canModerate,
      })),
    };
  }

  async addComment(user: AuthUser, slug: string, input: z.infer<typeof CommentSchema>) {
    await this.flags.assert('comments', 'Comments');
    const p = await this.publicProject(slug);
    if (!p.commentsEnabled) throw new ForbiddenException('The creator has turned off comments on this project.');
    if ((input.body.match(URL_RE) ?? []).length > MAX_LINKS) throw new BadRequestException(`Comments can include at most ${MAX_LINKS} links.`);
    if (input.parentId) {
      const parent = await this.prisma.projectComment.findFirst({ where: { id: input.parentId, projectId: p.id, status: 'visible', parentId: null } });
      if (!parent) throw new BadRequestException('You can only reply to a visible top-level comment on this project.');
    }
    const hourAgo = new Date(Date.now() - 3_600_000);
    if ((await this.prisma.projectComment.count({ where: { authorId: user.id, createdAt: { gt: hourAgo } } })) >= COMMENTS_PER_HOUR) {
      throw new HttpException({ message: 'You’re commenting very quickly. Try again in a little while.', code: 'comment_rate' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const dup = await this.prisma.projectComment.findFirst({ where: { authorId: user.id, projectId: p.id, body: input.body, createdAt: { gt: new Date(Date.now() - 600_000) } } });
    if (dup) throw new ConflictException('You already posted that.');
    const c = await this.prisma.projectComment.create({ data: { projectId: p.id, authorId: user.id, body: input.body, parentId: input.parentId ?? null }, include: { author: { select: authorSelect } } });
    return { id: c.id, parentId: c.parentId, body: c.body, createdAt: c.createdAt.toISOString(), author: { handle: c.author.handle, name: authorName(c.author) }, byCreator: c.authorId === p.createdById, mine: true, canRemove: true };
  }

  async removeComment(user: AuthUser, commentId: string, ip: string | null) {
    const c = await this.prisma.projectComment.findUnique({ where: { id: commentId }, include: { project: { select: { organizationId: true } } } });
    if (!c || c.status === 'removed') throw new NotFoundException('Comment not found');
    let reason: 'author' | 'owner' | 'moderator' | null = c.authorId === user.id ? 'author' : null;
    if (!reason) {
      const role = await this.orgs.assertRole(user.id, c.project.organizationId, 'admin').then(() => true, () => false);
      reason = role ? 'owner' : user.platformRole !== 'user' ? 'moderator' : null;
    }
    if (!reason) throw new NotFoundException('Comment not found'); // don't reveal that it exists
    await this.prisma.projectComment.update({ where: { id: c.id }, data: { status: 'removed', removedReason: reason } });
    if (reason !== 'author') await this.audit.record({ action: 'comment.removed', actorId: user.id, organizationId: c.project.organizationId, targetType: 'comment', targetId: c.id, ip, metadata: { by: reason } });
    return { removed: true };
  }

  /** One report per user per comment; three distinct reports hide it until a moderator decides. */
  async reportComment(user: AuthUser, commentId: string, input: z.infer<typeof CommentReportSchema>) {
    const c = await this.prisma.projectComment.findFirst({ where: { id: commentId, status: 'visible', project: publicWhere } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.authorId === user.id) throw new BadRequestException('You can’t report your own comment.');
    const r = await this.prisma.commentReport.createMany({ data: [{ commentId: c.id, reporterId: user.id, reason: input.reason }], skipDuplicates: true });
    if (!r.count) return { reported: true, duplicate: true };
    const open = await this.prisma.commentReport.count({ where: { commentId: c.id, resolvedAt: null } });
    if (open >= AUTO_HIDE_COMMENT_REPORTS) {
      await this.prisma.projectComment.update({ where: { id: c.id }, data: { status: 'hidden', removedReason: 'auto_hidden' } });
      await this.audit.record({ action: 'comment.auto_hidden', targetType: 'comment', targetId: c.id, metadata: { openReports: open } });
    }
    return { reported: true, duplicate: false };
  }

  async moderationQueue() {
    const rows = await this.prisma.projectComment.findMany({
      where: { status: { not: 'removed' }, reports: { some: { resolvedAt: null } } },
      orderBy: { createdAt: 'desc' }, take: 100,
      include: { author: { select: { email: true, handle: true } }, project: { select: { slug: true, name: true, publicTitle: true } }, reports: { where: { resolvedAt: null }, select: { reason: true } } },
    });
    return rows.map((c) => ({ id: c.id, body: c.body, status: c.status, createdAt: c.createdAt.toISOString(), author: c.author.handle ?? c.author.email, project: { slug: c.project.slug, title: c.project.publicTitle ?? c.project.name }, reports: c.reports.map((r) => r.reason) }));
  }

  async moderate(actor: AuthUser, commentId: string, action: 'remove' | 'restore') {
    const c = await this.prisma.projectComment.findUnique({ where: { id: commentId }, include: { project: { select: { organizationId: true } } } });
    if (!c) throw new NotFoundException('Comment not found');
    await this.prisma.$transaction([
      this.prisma.projectComment.update({ where: { id: c.id }, data: action === 'remove' ? { status: 'removed', removedReason: 'moderator' } : { status: 'visible', removedReason: null } }),
      this.prisma.commentReport.updateMany({ where: { commentId: c.id, resolvedAt: null }, data: { resolvedAt: new Date() } }),
    ]);
    await this.audit.record({ action: action === 'remove' ? 'admin.comment_removed' : 'admin.comment_restored', actorId: actor.id, organizationId: c.project.organizationId, targetType: 'comment', targetId: c.id });
    return { status: action === 'remove' ? 'removed' : 'visible' };
  }

  // ───────────── Follows ─────────────

  async follow(user: AuthUser, handle: string, on: boolean) {
    const target = await this.prisma.user.findUnique({ where: { handle: handle.toLowerCase() }, select: { id: true, status: true } });
    if (!target || target.status !== 'active') throw new NotFoundException('Creator not found');
    if (target.id === user.id) throw new BadRequestException('You can’t follow yourself.');
    if (on) await this.prisma.userFollow.createMany({ data: [{ followerId: user.id, followedId: target.id }], skipDuplicates: true });
    else await this.prisma.userFollow.deleteMany({ where: { followerId: user.id, followedId: target.id } });
    return { following: on, followers: await this.prisma.userFollow.count({ where: { followedId: target.id } }) };
  }

  async feed(user: AuthUser, page: number) {
    const take = 24;
    const rows = await this.prisma.project.findMany({
      where: { ...publicWhere, createdBy: { followers: { some: { followerId: user.id } } } },
      orderBy: { publishedAt: 'desc' }, skip: (page - 1) * take, take: take + 1, select: cardSelect,
    });
    const followingCount = await this.prisma.userFollow.count({ where: { followerId: user.id } });
    return { items: rows.slice(0, take).map(toCard), page, hasMore: rows.length > take, followingCount };
  }

  // ───────────── Collections ─────────────

  async myCollections(user: AuthUser, slug?: string) {
    const rows = await this.prisma.showcaseCollection.findMany({ where: { ownerId: user.id }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { items: true } } } });
    const has = new Set<string>();
    if (slug) {
      const p = await this.prisma.project.findFirst({ where: { slug, ...publicWhere }, select: { id: true } });
      if (p) (await this.prisma.showcaseCollectionItem.findMany({ where: { projectId: p.id, collection: { ownerId: user.id } }, select: { collectionId: true } })).forEach((i) => has.add(i.collectionId));
    }
    return rows.map((c) => ({ id: c.id, name: c.name, description: c.description, isPublic: c.isPublic, count: c._count.items, ...(slug ? { has: has.has(c.id) } : {}) }));
  }

  async createCollection(user: AuthUser, input: z.infer<typeof CollectionSchema>) {
    if ((await this.prisma.showcaseCollection.count({ where: { ownerId: user.id } })) >= MAX_COLLECTIONS) throw new HttpException({ message: `You can have up to ${MAX_COLLECTIONS} collections.`, code: 'collection_limit' }, HttpStatus.CONFLICT);
    const c = await this.prisma.showcaseCollection.create({ data: { ownerId: user.id, ...input } });
    return { id: c.id, name: c.name, description: c.description, isPublic: c.isPublic, count: 0 };
  }

  private async own(user: AuthUser, id: string) {
    const c = await this.prisma.showcaseCollection.findFirst({ where: { id, ownerId: user.id } });
    if (!c) throw new NotFoundException('Collection not found');
    return c;
  }

  async updateCollection(user: AuthUser, id: string, input: z.infer<typeof CollectionPatchSchema>) {
    await this.own(user, id);
    const c = await this.prisma.showcaseCollection.update({ where: { id }, data: input });
    return { id: c.id, name: c.name, description: c.description, isPublic: c.isPublic };
  }

  async deleteCollection(user: AuthUser, id: string) {
    await this.own(user, id);
    await this.prisma.showcaseCollection.delete({ where: { id } });
  }

  async setItem(user: AuthUser, id: string, slug: string, on: boolean) {
    await this.own(user, id);
    if (on) {
      const p = await this.prisma.project.findFirst({ where: { slug, ...publicWhere }, select: { id: true } });
      if (!p) throw new NotFoundException('Project not found');
      if ((await this.prisma.showcaseCollectionItem.count({ where: { collectionId: id } })) >= MAX_ITEMS) throw new HttpException({ message: `A collection holds up to ${MAX_ITEMS} projects.`, code: 'collection_full' }, HttpStatus.CONFLICT);
      await this.prisma.showcaseCollectionItem.createMany({ data: [{ collectionId: id, projectId: p.id }], skipDuplicates: true });
    } else {
      // Removal works even if the project has since been unpublished.
      const p = await this.prisma.project.findUnique({ where: { slug }, select: { id: true } });
      if (p) await this.prisma.showcaseCollectionItem.deleteMany({ where: { collectionId: id, projectId: p.id } });
    }
    await this.prisma.showcaseCollection.update({ where: { id }, data: { updatedAt: new Date() } });
    return { in: on };
  }

  /** Public collections are readable by anyone; private ones only by their owner. Unpublished or hidden projects silently drop out. */
  async collection(id: string, viewer: AuthUser | null) {
    const c = await this.prisma.showcaseCollection.findUnique({ where: { id }, include: { owner: { select: { handle: true, displayName: true, status: true } } } });
    if (!c || c.owner.status !== 'active' || (!c.isPublic && c.ownerId !== viewer?.id)) throw new NotFoundException('Collection not found');
    const items = await this.prisma.showcaseCollectionItem.findMany({ where: { collectionId: id, project: publicWhere }, orderBy: { addedAt: 'desc' }, take: MAX_ITEMS, include: { project: { select: cardSelect } } });
    return { id: c.id, name: c.name, description: c.description, isPublic: c.isPublic, mine: c.ownerId === viewer?.id, owner: { handle: c.owner.handle, name: c.owner.displayName ?? c.owner.handle ?? 'Member' }, items: items.map((i) => toCard(i.project as Prisma.ProjectGetPayload<{ select: typeof cardSelect }>)) };
  }
}
