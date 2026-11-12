import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OrgRole, PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import { ROLE_RANK } from '../auth/auth.types.js';

@Injectable()
export class OrgsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Throws 404 (not 403) for orgs the user can't see, so org IDs can't be probed. */
  async assertRole(userId: string, organizationId: string, min: OrgRole): Promise<OrgRole> {
    const m = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!m) throw new NotFoundException('Organization not found');
    if (ROLE_RANK[m.role] < ROLE_RANK[min]) throw new ForbiddenException(`Requires ${min} role`);
    return m.role;
  }

  listForUser(userId: string) {
    return this.prisma.organizationMembership.findMany({
      where: { userId },
      select: { role: true, organization: { select: { id: true, name: true, slug: true, personal: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
