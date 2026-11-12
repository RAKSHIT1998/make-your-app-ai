import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';

/** Owner-console moderation for the public showcase. Every action is audited. */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async queue() {
    const reports = await this.prisma.projectReport.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { project: { select: { id: true, slug: true, name: true, publicTitle: true, moderatedAt: true, featuredAt: true, createdBy: { select: { email: true, handle: true } } } }, reporter: { select: { email: true } } },
    });
    const published = await this.prisma.project.findMany({
      where: { visibility: 'public', deletedAt: null, publishedVersionId: { not: null } },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      select: { id: true, slug: true, name: true, publicTitle: true, featuredAt: true, moderatedAt: true, moderationNote: true, likeCount: true, viewCount: true, remixCount: true, publishedAt: true, createdBy: { select: { handle: true, email: true } } },
    });
    return {
      reports: reports.map((r) => ({ id: r.id, reason: r.reason, details: r.details, createdAt: r.createdAt.toISOString(), reporter: r.reporter.email, project: { id: r.project.id, slug: r.project.slug, title: r.project.publicTitle ?? r.project.name, hidden: !!r.project.moderatedAt, creator: r.project.createdBy.handle ?? r.project.createdBy.email } })),
      published: published.map((p) => ({ id: p.id, slug: p.slug, title: p.publicTitle ?? p.name, featured: !!p.featuredAt, hidden: !!p.moderatedAt, note: p.moderationNote, likes: p.likeCount, views: p.viewCount, remixes: p.remixCount, publishedAt: p.publishedAt?.toISOString() ?? null, creator: p.createdBy.handle ?? p.createdBy.email })),
    };
  }

  async feature(actor: AuthUser, projectId: string, on: boolean) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, visibility: 'public', deletedAt: null } });
    if (!p) throw new NotFoundException('Published project not found');
    await this.prisma.project.update({ where: { id: p.id }, data: { featuredAt: on ? new Date() : null } });
    await this.audit.record({ action: on ? 'admin.project_featured' : 'admin.project_unfeatured', actorId: actor.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id });
    return { featured: on };
  }

  /** hide = take it off the showcase (blocks republishing); restore = clear the hold. */
  async setHidden(actor: AuthUser, projectId: string, hidden: boolean, note: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!p) throw new NotFoundException('Project not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: p.id }, data: hidden ? { moderatedAt: new Date(), moderationNote: note, featuredAt: null } : { moderatedAt: null, moderationNote: null } });
      await tx.projectReport.updateMany({ where: { projectId: p.id, status: 'open' }, data: { status: hidden ? 'actioned' : 'dismissed', resolvedAt: new Date() } });
    });
    await this.audit.record({ action: hidden ? 'admin.project_hidden' : 'admin.project_restored', actorId: actor.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, metadata: { note } });
    return { hidden };
  }

  async dismiss(actor: AuthUser, reportId: string) {
    const r = await this.prisma.projectReport.update({ where: { id: reportId }, data: { status: 'dismissed', resolvedAt: new Date() } }).catch(() => null);
    if (!r) throw new NotFoundException('Report not found');
    await this.audit.record({ action: 'admin.report_dismissed', actorId: actor.id, targetType: 'project_report', targetId: r.id });
    return { dismissed: true };
  }
}
