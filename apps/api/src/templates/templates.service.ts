import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient, Template } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { FlagsService } from '../flags/flags.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { ProjectsService, toProjectDto } from '../projects/projects.service.js';
import { GenerationsService } from '../generation/generations.service.js';
import { CATEGORIES, SECRET_FILE } from '../growth/showcase.service.js';

export const SubmitTemplateSchema = z.object({
  title: z.string().trim().min(3).max(80).optional(),
  description: z.string().trim().max(600).optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
});
export const TemplatesQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  type: z.enum(['mobile_app', 'website', 'ecommerce', 'business_website', 'saas', 'custom_software']).optional(),
  category: z.enum(CATEGORIES).optional(),
  sort: z.enum(['popular', 'new', 'featured']).default('popular'),
});

interface Snapshot { pages?: { route: string; title: string; purpose: string }[]; palette?: Record<string, string> | null; fileCount?: number; summary?: string | null }

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async card(t: Template) {
    const creator = await this.prisma.user.findUnique({ where: { id: t.creatorId }, select: { handle: true, displayName: true } });
    const snap = (t.snapshot ?? {}) as Snapshot;
    return {
      slug: t.slug, title: t.title, description: t.description, category: t.category, type: t.type, uses: t.usesCount, featured: !!t.featuredAt, free: t.priceMinor === 0,
      pageCount: snap.pages?.length ?? 0, palette: snap.palette ?? null, pages: snap.pages ?? [], fileCount: snap.fileCount ?? 0, summary: snap.summary ?? null,
      creator: { handle: creator?.handle ?? null, name: creator?.displayName ?? creator?.handle ?? null },
    };
  }

  // ───────── Creators ─────────

  async mine(user: AuthUser, projectId: string) {
    await this.projects.getAuthorized(user, projectId, 'viewer');
    const t = await this.prisma.template.findUnique({ where: { projectId } });
    return t ? { status: t.status, slug: t.slug, title: t.title, reviewNote: t.reviewNote, uses: t.usesCount, submittedAt: t.updatedAt.toISOString() } : null;
  }

  /** Offer a published project as a template. Snapshots the PUBLISHED version; goes to owner review. */
  async submit(user: AuthUser, projectId: string, input: z.infer<typeof SubmitTemplateSchema>, ip: string | null) {
    await this.flags.assert('templates', 'Templates');
    const p = await this.projects.getAuthorized(user, projectId, 'admin');
    if (p.visibility !== 'public' || !p.publishedVersionId || p.moderatedAt) throw new BadRequestException('Publish the project first — templates are made from the published version.');
    const existing = await this.prisma.template.findUnique({ where: { projectId } });
    if (existing?.status === 'pending') throw new ConflictException('This template is already waiting for review.');
    const data = {
      versionId: p.publishedVersionId,
      title: input.title ?? p.publicTitle ?? p.name,
      description: input.description ?? p.publicDescription ?? p.description,
      category: input.category !== undefined ? input.category : p.category,
      type: p.type,
      snapshot: (p.publishedSnapshot ?? {}) as Prisma.InputJsonValue,
      status: 'pending' as const,
      reviewNote: null,
      reviewedAt: null,
      reviewedBy: null,
    };
    const t = existing
      ? await this.prisma.template.update({ where: { id: existing.id }, data })
      : await this.prisma.template.create({ data: { ...data, projectId, creatorId: user.id, slug: `${(data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'template')}-${randomBytes(3).toString('hex')}` } });
    await this.audit.record({ action: 'template.submitted', actorId: user.id, organizationId: p.organizationId, targetType: 'template', targetId: t.id, ip });
    return this.mine(user, projectId);
  }

  async withdraw(user: AuthUser, projectId: string, ip: string | null) {
    const p = await this.projects.getAuthorized(user, projectId, 'admin');
    const t = await this.prisma.template.findUnique({ where: { projectId } });
    if (!t || t.status === 'withdrawn') throw new NotFoundException('No template for this project.');
    await this.prisma.template.update({ where: { id: t.id }, data: { status: 'withdrawn' } });
    await this.audit.record({ action: 'template.withdrawn', actorId: user.id, organizationId: p.organizationId, targetType: 'template', targetId: t.id, ip });
    return this.mine(user, projectId);
  }

  // ───────── Gallery ─────────

  async list(q: z.infer<typeof TemplatesQuerySchema>) {
    await this.flags.assert('templates', 'Templates');
    const rows = await this.prisma.template.findMany({
      where: {
        status: 'approved', project: { deletedAt: null },
        ...(q.type ? { type: q.type } : {}), ...(q.category ? { category: q.category } : {}), ...(q.sort === 'featured' ? { featuredAt: { not: null } } : {}),
        ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: q.sort === 'new' ? [{ reviewedAt: 'desc' }] : q.sort === 'featured' ? [{ featuredAt: 'desc' }] : [{ usesCount: 'desc' }, { reviewedAt: 'desc' }],
      take: 60,
    });
    return Promise.all(rows.map((t) => this.card(t)));
  }

  async get(slug: string) {
    const t = await this.prisma.template.findFirst({ where: { slug, status: 'approved', project: { deletedAt: null } } });
    if (!t) throw new NotFoundException('Template not found');
    return this.card(t);
  }

  /** Starts a new project in the caller's workspace from the template's frozen files. No AI, no credits. */
  async use(user: AuthUser, slug: string, organizationId: string | undefined, name: string | undefined, ip: string | null) {
    await this.flags.assert('templates', 'Templates');
    const t = await this.prisma.template.findFirst({ where: { slug, status: 'approved', project: { deletedAt: null } }, include: { project: true } });
    if (!t) throw new NotFoundException('Template not found');
    if (t.priceMinor > 0) throw new HttpException('Paid templates aren’t available yet.', HttpStatus.PAYMENT_REQUIRED);
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'member');
    const ent = await this.credits.entitlement(orgId);
    if (!ent.projectTypes.includes(t.type)) throw new HttpException({ message: 'Your plan doesn’t include this project type yet.', code: 'plan_project_type' }, HttpStatus.PAYMENT_REQUIRED);
    const version = await this.prisma.projectVersion.findUniqueOrThrow({ where: { id: t.versionId } });
    const tree = await this.generations.readVersionTree(t.projectId, version.commitSha);
    for (const path of [...tree.keys()]) if (SECRET_FILE.test(path)) tree.delete(path);
    const dto = await this.projects.create(user, { name: (name ?? t.title).slice(0, 80), description: t.description, type: t.type, organizationId: orgId }, ip);
    const created = await this.prisma.project.update({ where: { id: dto.id }, data: { fromTemplateId: t.id } });
    await this.generations.importTree(created, tree, `Started from the “${t.title}” template`, {
      ...(t.project.templateId ? { templateId: t.project.templateId } : {}),
      ...(t.project.spec ? { spec: t.project.spec as Prisma.InputJsonValue } : {}),
      ...(t.project.designSpec ? { designSpec: t.project.designSpec as Prisma.InputJsonValue } : {}),
    });
    await this.prisma.template.update({ where: { id: t.id }, data: { usesCount: { increment: 1 } } });
    await this.audit.record({ action: 'template.used', actorId: user.id, organizationId: orgId, targetType: 'project', targetId: dto.id, ip, metadata: { templateId: t.id } });
    return toProjectDto(await this.prisma.project.findUniqueOrThrow({ where: { id: dto.id } }));
  }

  // ───────── Owner review ─────────

  async queue(status: 'pending' | 'approved' | 'rejected' | undefined) {
    const rows = await this.prisma.template.findMany({ where: status ? { status } : { status: { not: 'withdrawn' } }, orderBy: { updatedAt: 'desc' }, take: 100, include: { project: { select: { slug: true } } } });
    return Promise.all(rows.map(async (t) => ({ id: t.id, status: t.status, reviewNote: t.reviewNote, projectSlug: t.project.slug, submittedAt: t.updatedAt.toISOString(), ...(await this.card(t)) })));
  }

  async review(actor: AuthUser, id: string, decision: 'approve' | 'reject' | 'feature' | 'unfeature', note?: string) {
    const t = await this.prisma.template.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    const data: Prisma.TemplateUpdateInput =
      decision === 'approve' ? { status: 'approved', reviewNote: note ?? null, reviewedAt: new Date(), reviewedBy: actor.id }
      : decision === 'reject' ? { status: 'rejected', reviewNote: note ?? 'Not approved', reviewedAt: new Date(), reviewedBy: actor.id, featuredAt: null }
      : { featuredAt: decision === 'feature' ? new Date() : null };
    if ((decision === 'feature') && t.status !== 'approved') throw new BadRequestException('Only approved templates can be featured.');
    await this.prisma.template.update({ where: { id }, data });
    await this.audit.record({ action: `admin.template_${decision}`, actorId: actor.id, targetType: 'template', targetId: id, metadata: { note: note ?? null } });
    return { status: decision };
  }
}
