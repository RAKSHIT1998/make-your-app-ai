import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from './auth.types.js';
import type { VerifiedClaims } from './token-verifier.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Upserts the platform user for a verified Supabase identity and ensures a personal org exists. */
  async resolveUser(claims: VerifiedClaims, ip: string | null): Promise<AuthUser> {
    const existing = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: { memberships: { where: { organization: { personal: true } }, select: { organizationId: true } } },
    });

    if (existing) {
      if (existing.status !== 'active') throw new ForbiddenException('Account is not active');
      const personalOrgId = existing.memberships[0]?.organizationId ?? (await this.createPersonalOrg(existing.id, existing.email));
      if (existing.email !== claims.email) {
        await this.prisma.user.update({ where: { id: existing.id }, data: { email: claims.email } });
      }
      return { id: existing.id, email: claims.email, platformRole: existing.platformRole, personalOrgId };
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { id: claims.sub, email: claims.email } });
      await this.audit.record({ action: 'auth.user_created', actorId: u.id, ip }, tx);
      return u;
    });
    const personalOrgId = await this.createPersonalOrg(user.id, user.email);
    return { id: user.id, email: user.email, platformRole: user.platformRole, personalOrgId };
  }

  private async createPersonalOrg(userId: string, email: string): Promise<string> {
    const base = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'workspace';
    const slug = `${base}-${userId.slice(0, 8)}`;
    const org = await this.prisma.organization.upsert({
      where: { slug },
      update: {},
      create: {
        name: 'Personal workspace',
        slug,
        personal: true,
        memberships: { create: { userId, role: 'owner' } },
      },
    });
    return org.id;
  }
}
