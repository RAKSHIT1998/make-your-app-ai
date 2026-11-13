import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient, Project } from '@mya/db';
import { z } from 'zod';
import { APP_BACKEND_FILE, buildPreviewDocument } from '@mya/shared';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { ProjectsService, toProjectDto } from '../projects/projects.service.js';
import { GenerationsService } from '../generation/generations.service.js';
import { FlagsService } from '../flags/flags.service.js';

export const CATEGORIES = ['business', 'portfolio', 'restaurant', 'ecommerce', 'education', 'health', 'events', 'nonprofit', 'saas', 'personal', 'other'] as const;

export const PublishSchema = z.object({
  visibility: z.enum(['private', 'public']),
  publicTitle: z.string().trim().min(1).max(80).optional(),
  publicDescription: z.string().trim().max(600).optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
  allowRemix: z.boolean().optional(),
  commentsEnabled: z.boolean().optional(),
  showAttribution: z.boolean().optional(),
});
export type PublishInput = z.infer<typeof PublishSchema>;

export const ExploreQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  type: z.enum(['mobile_app', 'website', 'ecommerce', 'business_website', 'saas', 'custom_software', 'game']).optional(),
  category: z.enum(CATEGORIES).optional(),
  sort: z.enum(['trending', 'recent', 'popular', 'featured']).default('trending'),
  page: z.coerce.number().int().min(1).max(50).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

export const ReportSchema = z.object({
  reason: z.enum(['spam', 'abuse', 'copyright', 'illegal', 'impersonation', 'other']),
  details: z.string().trim().max(1000).default(''),
});

/** Files never copied into a remix, even if a generator ever wrote them. */
/** Project types built from the static `web-play` template, which can run in a sandboxed iframe. */
const PLAYABLE_TYPES = new Set<string>(['game', 'custom_software', 'saas']);
export const SECRET_FILE = /(^|\/)(\.env(\..*)?|\.npmrc|id_rsa.*|.*\.pem|.*\.key|secrets?\.(json|ya?ml))$/i;
const AUTO_HIDE_REPORTS = 3;
const RESERVED_HANDLES = new Set(['admin', 'api', 'app', 'explore', 'login', 'pricing', 'settings', 'billing', 'support', 'help', 'about', 'legal', 'mya', 'makeyourapp', 'official', 'staff', 'team']);

export const HandleSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, 'Use 3–30 lowercase letters, numbers or hyphens.').refine((h) => !RESERVED_HANDLES.has(h), 'That handle is reserved.');

export const publicWhere: Prisma.ProjectWhereInput = { visibility: 'public', deletedAt: null, moderatedAt: null, publishedVersionId: { not: null } };
export const cardSelect = {
  id: true, slug: true, type: true, category: true, publicTitle: true, name: true, publicDescription: true, description: true, publishedAt: true, featuredAt: true,
  likeCount: true, viewCount: true, remixCount: true, allowRemix: true, publishedSnapshot: true,
  createdBy: { select: { handle: true, displayName: true } },
} satisfies Prisma.ProjectSelect;
type CardRow = Prisma.ProjectGetPayload<{ select: typeof cardSelect }>;

interface Snapshot { versionNumber: number; fileCount: number; pages: { route: string; title: string; purpose: string }[]; palette: Record<string, string> | null; summary: string | null; audience: string | null }

export function toCard(p: CardRow) {
  const snap = (p.publishedSnapshot ?? null) as Snapshot | null;
  return {
    slug: p.slug!, type: p.type, category: p.category, title: p.publicTitle ?? p.name, description: p.publicDescription ?? p.description,
    publishedAt: p.publishedAt?.toISOString() ?? null, featured: !!p.featuredAt, likes: p.likeCount, views: p.viewCount, remixes: p.remixCount, allowRemix: p.allowRemix,
    pageCount: snap?.pages.length ?? 0, palette: snap?.palette ?? null,
    creator: { handle: p.createdBy.handle, name: p.createdBy.displayName ?? p.createdBy.handle },
  };
}

@Injectable()
export class ShowcaseService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  // ───────── Owner: publishing ─────────

  async publishing(user: AuthUser, projectId: string) {
    const p = await this.projects.getAuthorized(user, projectId, 'viewer');
    const ent = await this.credits.entitlement(p.organizationId);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { handle: true } });
    return {
      visibility: p.visibility,
      slug: p.slug,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      publicTitle: p.publicTitle ?? p.name,
      publicDescription: p.publicDescription ?? p.description,
      category: p.category,
      allowRemix: p.allowRemix,
      commentsEnabled: p.commentsEnabled,
      showAttribution: p.showAttribution,
      canHideAttribution: ent.source !== 'free',
      hasVersion: !!p.headVersionId,
      /** True when the project changed after it was published (visitors still see the published version). */
      outdated: p.visibility === 'public' && !!p.publishedVersionId && p.publishedVersionId !== p.headVersionId,
      moderated: !!p.moderatedAt,
      moderationNote: p.moderationNote,
      creatorHandle: me.handle,
    };
  }

  async publish(user: AuthUser, projectId: string, input: PublishInput, ip: string | null) {
    const p = await this.projects.getAuthorized(user, projectId, 'member');
    const ent = await this.credits.entitlement(p.organizationId);
    if (input.showAttribution === false && ent.source === 'free') throw new HttpException({ message: 'Removing the "Made with Make Your App AI" badge needs a paid plan.', code: 'plan_attribution' }, HttpStatus.PAYMENT_REQUIRED);
    const data: Prisma.ProjectUncheckedUpdateInput = {
      ...(input.publicTitle !== undefined ? { publicTitle: input.publicTitle } : {}),
      ...(input.publicDescription !== undefined ? { publicDescription: input.publicDescription } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.allowRemix !== undefined ? { allowRemix: input.allowRemix } : {}),
      ...(input.commentsEnabled !== undefined ? { commentsEnabled: input.commentsEnabled } : {}),
      ...(input.showAttribution !== undefined ? { showAttribution: input.showAttribution } : {}),
      visibility: input.visibility,
    };
    if (input.visibility === 'public') {
      await this.flags.assert('publishing', 'Publishing');
      if (p.status === 'archived') throw new BadRequestException('Archived projects can’t be published.');
      if (!p.headVersionId) throw new BadRequestException('Generate the project before publishing it.');
      if (p.moderatedAt) throw new ForbiddenException('This project was unpublished by a moderator and can’t be republished. Contact support.');
      await this.ensureHandle(user.id);
      const head = await this.prisma.projectVersion.findUniqueOrThrow({ where: { id: p.headVersionId } });
      Object.assign(data, {
        publishedVersionId: head.id,
        publishedAt: new Date(),
        publishedSnapshot: (await this.snapshot(p, head.number)) as unknown as Prisma.InputJsonValue,
        slug: p.slug ?? (await this.uniqueSlug(input.publicTitle ?? p.publicTitle ?? p.name)),
      });
    }
    await this.prisma.project.update({ where: { id: p.id }, data });
    await this.audit.record({ action: input.visibility === 'public' ? 'project.published' : 'project.unpublished', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip });
    return this.publishing(user, projectId);
  }

  private async snapshot(p: Project, versionNumber: number): Promise<Snapshot> {
    const spec = (p.spec ?? null) as { pages?: { route: string; title: string; purpose: string }[]; summary?: string; audience?: string } | null;
    const design = (p.designSpec ?? null) as { palette?: Record<string, string> } | null;
    return {
      versionNumber,
      fileCount: await this.prisma.projectFile.count({ where: { projectId: p.id } }),
      pages: (spec?.pages ?? []).slice(0, 15).map((x) => ({ route: x.route, title: x.title, purpose: x.purpose })),
      palette: design?.palette ?? null,
      summary: spec?.summary ?? null,
      audience: spec?.audience ?? null,
    };
  }

  private async uniqueSlug(title: string) {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
    for (let i = 0; i < 5; i++) {
      const slug = `${base}-${randomBytes(3).toString('hex')}`;
      if (!(await this.prisma.project.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
    throw new ConflictException('Could not allocate a public link, try again.');
  }

  /** Creators get a handle the first time they publish; they can change it in Settings. */
  async ensureHandle(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true, email: true, displayName: true } });
    if (u.handle) return u.handle;
    const base = (u.displayName ?? u.email.split('@')[0]!).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 22).padEnd(3, '0');
    for (let i = 0; i < 6; i++) {
      const handle = i === 0 && !RESERVED_HANDLES.has(base) ? base : `${base}-${randomBytes(2).toString('hex')}`;
      const ok = await this.prisma.user.updateMany({ where: { id: userId, handle: null }, data: { handle } }).catch(() => ({ count: 0 }));
      if (ok.count) return handle;
      const now = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } });
      if (now.handle) return now.handle;
    }
    throw new ConflictException('Could not create a creator handle, set one in Settings.');
  }

  // ───────── Public: Explore, pages, creators ─────────

  async explore(q: z.infer<typeof ExploreQuerySchema>) {
    await this.flags.assert('explore', 'Explore');
    const where: Prisma.ProjectWhereInput = {
      ...publicWhere,
      ...(q.type ? { type: q.type } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.sort === 'featured' ? { featuredAt: { not: null } } : {}),
      ...(q.q ? { OR: [{ publicTitle: { contains: q.q, mode: 'insensitive' } }, { publicDescription: { contains: q.q, mode: 'insensitive' } }, { createdBy: { handle: { contains: q.q.toLowerCase() } } }] } : {}),
    };
    const skip = (q.page - 1) * q.limit;
    let rows: CardRow[];
    if (q.sort === 'trending') {
      // Engagement in the last 7 days: likes ×3, remixes ×5, unique daily views ×1, with a small recency boost.
      const ids = (await this.prisma.project.findMany({ where, select: { id: true } })).map((r) => r.id);
      if (!ids.length) return { items: [], page: q.page, hasMore: false };
      const scores = await this.prisma.$queryRaw<{ id: string; score: number }[]>`
        SELECT p.id::text AS id,
          (COALESCE(l.n,0) * 3 + COALESCE(r.n,0) * 5 + COALESCE(v.n,0)
            + GREATEST(0, 7 - EXTRACT(EPOCH FROM (now() - p."publishedAt")) / 86400))::float AS score
        FROM "Project" p
        LEFT JOIN (SELECT "projectId", count(*) n FROM "ProjectLike" WHERE "createdAt" > now() - interval '7 days' GROUP BY 1) l ON l."projectId" = p.id
        LEFT JOIN (SELECT "remixedFromId", count(*) n FROM "Project" WHERE "createdAt" > now() - interval '7 days' AND "remixedFromId" IS NOT NULL GROUP BY 1) r ON r."remixedFromId" = p.id
        LEFT JOIN (SELECT "projectId", count(*) n FROM "ProjectViewDay" WHERE day > (now() - interval '7 days')::date GROUP BY 1) v ON v."projectId" = p.id
        WHERE p.id = ANY(${ids}::uuid[])
        ORDER BY score DESC, p."publishedAt" DESC
        OFFSET ${skip} LIMIT ${q.limit + 1}`;
      const found = await this.prisma.project.findMany({ where: { id: { in: scores.map((s) => s.id) } }, select: cardSelect });
      const byId = new Map(found.map((f) => [f.id, f]));
      rows = scores.map((s) => byId.get(s.id)).filter((x): x is CardRow => !!x);
    } else {
      const orderBy: Prisma.ProjectOrderByWithRelationInput[] = q.sort === 'popular' ? [{ likeCount: 'desc' }, { viewCount: 'desc' }] : q.sort === 'featured' ? [{ featuredAt: 'desc' }] : [{ publishedAt: 'desc' }];
      rows = await this.prisma.project.findMany({ where, orderBy, skip, take: q.limit + 1, select: cardSelect });
    }
    return { items: rows.slice(0, q.limit).map(toCard), page: q.page, hasMore: rows.length > q.limit };
  }

  private async findPublic(slug: string) {
    const p = await this.prisma.project.findFirst({ where: { slug, ...publicWhere }, select: { ...cardSelect, organizationId: true, showAttribution: true, remixedFromId: true, publishedVersionId: true, createdById: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  async page(slug: string, viewer: AuthUser | null) {
    const p = await this.findPublic(slug);
    const snap = (p.publishedSnapshot ?? null) as Snapshot | null;
    const [liked, member, origin, remixes] = await Promise.all([
      viewer ? this.prisma.projectLike.findUnique({ where: { projectId_userId: { projectId: p.id, userId: viewer.id } } }) : null,
      viewer ? this.prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: p.organizationId, userId: viewer.id } } }) : null,
      p.remixedFromId ? this.prisma.project.findFirst({ where: { id: p.remixedFromId, ...publicWhere }, select: cardSelect }) : null,
      this.prisma.project.findMany({ where: { remixedFromId: p.id, ...publicWhere }, orderBy: { likeCount: 'desc' }, take: 6, select: cardSelect }),
    ]);
    return {
      ...toCard(p),
      showAttribution: p.showAttribution,
      summary: snap?.summary ?? null,
      audience: snap?.audience ?? null,
      pages: snap?.pages ?? [],
      fileCount: snap?.fileCount ?? 0,
      versionNumber: snap?.versionNumber ?? null,
      likedByMe: !!liked,
      isOwner: !!member,
      projectId: member ? p.id : null,
      remixedFrom: origin ? toCard(origin) : p.remixedFromId ? { private: true as const } : null,
      remixList: remixes.map(toCard),
      preview: null, // Live previews of hosted sites arrive with hosting; we never show a fake one.
      /** Games and browser apps can be run right on the page (see play()). */
      playable: PLAYABLE_TYPES.has(p.type),
    };
  }

  /**
   * The published version of a game or browser app as one self-contained HTML document, for the sandboxed player on its
   * public page. Always the frozen published version (never later private edits), secret-like files stripped. The document
   * is only assembled here: it runs in the visitor's browser inside a sandboxed iframe with no network and an opaque origin.
   */
  async play(slug: string) {
    const p = await this.findPublic(slug);
    if (!PLAYABLE_TYPES.has(p.type)) throw new UnprocessableEntityException('This project can’t be run in the browser.');
    const version = await this.prisma.projectVersion.findUniqueOrThrow({ where: { id: p.publishedVersionId! } });
    const tree = await this.generations.readVersionTree(p.id, version.commitSha);
    for (const path of [...tree.keys()]) if (SECRET_FILE.test(path)) tree.delete(path);
    // A full-stack app on its public page uses its live data, separate from the builder's preview data.
    const backend = tree.has(APP_BACKEND_FILE) ? { api: `${this.config.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/appdata/lv_${p.id}`, env: 'live' as const } : undefined;
    const doc = buildPreviewDocument(tree, backend ? { backend } : {});
    if (!doc.ok) throw new UnprocessableEntityException(doc.reason);
    return { html: doc.html, versionNumber: version.number, backend: !!backend };
  }

  /** Counts a view once per viewer per day. Owners' own visits don't count. */
  async view(slug: string, viewer: AuthUser | null, ip: string | null, ua: string | undefined) {
    const p = await this.findPublic(slug);
    if (viewer && (await this.prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: p.organizationId, userId: viewer.id } } }))) return { counted: false };
    const key = createHash('sha256').update(viewer ? `u:${viewer.id}` : `a:${ip ?? ''}:${ua ?? ''}`).digest('hex');
    const day = new Date(new Date().toISOString().slice(0, 10));
    const ins = await this.prisma.projectViewDay.createMany({ data: [{ projectId: p.id, viewerKey: key, day }], skipDuplicates: true });
    if (ins.count) await this.prisma.project.update({ where: { id: p.id }, data: { viewCount: { increment: 1 } } });
    return { counted: ins.count === 1 };
  }

  async like(user: AuthUser, slug: string, on: boolean) {
    const p = await this.findPublic(slug);
    await this.prisma.$transaction(async (tx) => {
      if (on) {
        const r = await tx.projectLike.createMany({ data: [{ projectId: p.id, userId: user.id }], skipDuplicates: true });
        if (r.count) await tx.project.update({ where: { id: p.id }, data: { likeCount: { increment: 1 } } });
      } else {
        const r = await tx.projectLike.deleteMany({ where: { projectId: p.id, userId: user.id } });
        if (r.count) await tx.project.update({ where: { id: p.id }, data: { likeCount: { decrement: r.count } } });
      }
    });
    const fresh = await this.prisma.project.findUniqueOrThrow({ where: { id: p.id }, select: { likeCount: true } });
    return { liked: on, likes: fresh.likeCount };
  }

  /**
   * Remix: a new, separate project owned by the caller, seeded from the PUBLISHED version only.
   * The original is untouched; attribution is kept via remixedFromId. Secrets-like files are never copied.
   */
  async remix(user: AuthUser, slug: string, organizationId: string | undefined, ip: string | null) {
    await this.flags.assert('remix', 'Remix');
    const src = await this.findPublic(slug);
    if (!src.allowRemix) throw new ForbiddenException('The creator has turned off remixing for this project.');
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'member');
    const ent = await this.credits.entitlement(orgId);
    if (!ent.projectTypes.includes(src.type)) throw new HttpException({ message: 'Your plan doesn’t include this project type yet.', code: 'plan_project_type' }, HttpStatus.PAYMENT_REQUIRED);
    const full = await this.prisma.project.findUniqueOrThrow({ where: { id: src.id } });
    const version = await this.prisma.projectVersion.findUniqueOrThrow({ where: { id: src.publishedVersionId! } });
    const tree = await this.generations.readVersionTree(src.id, version.commitSha);
    for (const path of [...tree.keys()]) if (SECRET_FILE.test(path)) tree.delete(path);

    const title = src.publicTitle ?? src.name;
    const dto = await this.projects.create(user, { name: `Remix of ${title}`.slice(0, 80), description: src.publicDescription ?? src.description, type: src.type, organizationId: orgId }, ip);
    const created = await this.prisma.project.update({ where: { id: dto.id }, data: { remixedFromId: src.id } });
    await this.generations.importTree(created, tree, `Remixed from “${title}” by @${src.createdBy.handle}`, {
      ...(full.templateId ? { templateId: full.templateId } : {}),
      ...(full.spec ? { spec: full.spec as Prisma.InputJsonValue } : {}),
      ...(full.designSpec ? { designSpec: full.designSpec as Prisma.InputJsonValue } : {}),
    });
    await this.prisma.project.update({ where: { id: src.id }, data: { remixCount: { increment: 1 } } });
    await this.audit.record({ action: 'project.remixed', actorId: user.id, organizationId: orgId, targetType: 'project', targetId: dto.id, ip, metadata: { from: src.id } });
    return toProjectDto(await this.prisma.project.findUniqueOrThrow({ where: { id: dto.id } }));
  }

  async creator(handle: string, viewer: AuthUser | null) {
    const u = await this.prisma.user.findUnique({ where: { handle: handle.toLowerCase() }, select: { id: true, handle: true, displayName: true, bio: true, createdAt: true, status: true } });
    if (!u || u.status !== 'active') throw new NotFoundException('Creator not found');
    const projects = await this.prisma.project.findMany({ where: { createdById: u.id, ...publicWhere }, orderBy: { publishedAt: 'desc' }, take: 60, select: cardSelect });
    const [followers, following, mine] = await Promise.all([
      this.prisma.userFollow.count({ where: { followedId: u.id } }),
      this.prisma.userFollow.count({ where: { followerId: u.id } }),
      viewer ? this.prisma.userFollow.findUnique({ where: { followerId_followedId: { followerId: viewer.id, followedId: u.id } } }) : null,
    ]);
    return {
      followers, following, followedByMe: !!mine,
      handle: u.handle!, name: u.displayName ?? u.handle!, bio: u.bio, joinedAt: u.createdAt.toISOString(), isMe: viewer?.id === u.id,
      totals: { projects: projects.length, likes: projects.reduce((n, p) => n + p.likeCount, 0), remixes: projects.reduce((n, p) => n + p.remixCount, 0) },
      projects: projects.map(toCard),
    };
  }

  // ───────── Safety ─────────

  /** One report per user per project; 3 distinct open reports hide the project until a moderator reviews it. */
  async report(user: AuthUser, slug: string, input: z.infer<typeof ReportSchema>) {
    const p = await this.findPublic(slug);
    if (p.createdById === user.id) throw new BadRequestException('You can’t report your own project.');
    const r = await this.prisma.projectReport.createMany({ data: [{ projectId: p.id, reporterId: user.id, reason: input.reason, details: input.details }], skipDuplicates: true });
    if (!r.count) return { reported: true, duplicate: true };
    const open = await this.prisma.projectReport.count({ where: { projectId: p.id, status: 'open' } });
    if (open >= AUTO_HIDE_REPORTS) {
      await this.prisma.project.update({ where: { id: p.id }, data: { moderatedAt: new Date(), moderationNote: 'Hidden automatically after multiple reports, pending review.' } });
      await this.audit.record({ action: 'project.auto_hidden', organizationId: p.organizationId, targetType: 'project', targetId: p.id, metadata: { openReports: open } });
    }
    return { reported: true, duplicate: false };
  }
}
