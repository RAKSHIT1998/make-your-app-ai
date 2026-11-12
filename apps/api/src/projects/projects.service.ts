import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, Project } from '@mya/db';
import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from '@mya/shared';
import { PRISMA } from '../prisma.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CreditsService } from '../credits/credits.service.js';

export function toProjectDto(p: Project): ProjectDto {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    description: p.description,
    type: p.type,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CreditsService) private readonly credits: CreditsService,
  ) {}

  async create(user: AuthUser, input: CreateProjectInput, ip: string | null): Promise<ProjectDto> {
    const organizationId = input.organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, organizationId, 'member');
    const ent = await this.credits.entitlement(organizationId);
    if ((await this.credits.activeProjectCount(organizationId)) >= ent.maxActiveProjects) {
      throw new HttpException({ message: `Your plan allows ${ent.maxActiveProjects} active project${ent.maxActiveProjects === 1 ? '' : 's'}. Archive a project or upgrade to create more.`, code: 'plan_limit_projects' }, HttpStatus.PAYMENT_REQUIRED);
    }
    const project = await this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          organizationId,
          createdById: user.id,
          name: input.name,
          description: input.description,
          type: input.type,
        },
      });
      await this.audit.record(
        { action: 'project.created', actorId: user.id, organizationId, targetType: 'project', targetId: p.id, ip },
        tx,
      );
      return p;
    });
    return toProjectDto(project);
  }

  async list(user: AuthUser, q: { organizationId?: string | undefined; limit: number; cursor?: string | undefined }) {
    const organizationId = q.organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, organizationId, 'viewer');
    const rows = await this.prisma.project.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map(toProjectDto);
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  /** Loads a project and checks the caller's role in its organization. */
  async getAuthorized(user: AuthUser, id: string, min: 'viewer' | 'member' | 'admin' | 'owner' = 'viewer') {
    const p = await this.prisma.project.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Project not found');
    try {
      await this.orgs.assertRole(user.id, p.organizationId, min);
    } catch (e) {
      if (e instanceof NotFoundException) throw new NotFoundException('Project not found');
      throw e;
    }
    return p;
  }

  async get(user: AuthUser, id: string) {
    return toProjectDto(await this.getAuthorized(user, id));
  }

  async update(user: AuthUser, id: string, input: UpdateProjectInput, ip: string | null) {
    const p = await this.getAuthorized(user, id, 'member');
    const updated = await this.prisma.$transaction(async (tx) => {
      // Archiving also takes the project off its public page.
      const u = await tx.project.update({ where: { id: p.id }, data: { ...input, ...(input.status === 'archived' ? { visibility: 'private' as const } : {}) } });
      await this.audit.record(
        { action: 'project.updated', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip, metadata: { fields: Object.keys(input) } },
        tx,
      );
      return u;
    });
    return toProjectDto(updated);
  }

  /** Soft delete. Destructive — requires admin in the org. Source in git is retained for recovery. */
  async remove(user: AuthUser, id: string, ip: string | null) {
    const p = await this.getAuthorized(user, id, 'admin');
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: p.id }, data: { deletedAt: new Date(), status: 'archived', visibility: 'private' } });
      await this.audit.record(
        { action: 'project.deleted', actorId: user.id, organizationId: p.organizationId, targetType: 'project', targetId: p.id, ip },
        tx,
      );
    });
  }
}
