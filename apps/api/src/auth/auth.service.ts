import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from './auth.types.js';
import { CreditsService } from '../credits/credits.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import type { VerifiedClaims } from './token-verifier.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private isOwnerEmail(email: string) {
    return this.config.PLATFORM_OWNER_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
  }

  /** Promotes configured owner emails to superadmin (never demotes). Requires a verified Supabase identity. */
  private async bootstrapOwner(userId: string, email: string, role: string) {
    if (role === 'superadmin' || !this.isOwnerEmail(email)) return role;
    await this.prisma.user.update({ where: { id: userId }, data: { platformRole: 'superadmin' } });
    await this.audit.record({ action: 'admin.owner_bootstrapped', actorId: userId, metadata: { email } });
    return 'superadmin';
  }

  /** Upserts the platform user for a verified Supabase identity and ensures a personal org exists. */
  async resolveUser(claims: VerifiedClaims, ip: string | null): Promise<AuthUser> {
    const existing = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: { memberships: { where: { organization: { personal: true } }, select: { organizationId: true } } },
    });

    if (existing) {
      if (existing.status !== 'active') throw new ForbiddenException('Account is not active');
      const personalOrgId = existing.memberships[0]?.organizationId ?? (await this.createPersonalOrg(existing.id, existing.email));
      if (!existing.lastSeenAt || Date.now() - existing.lastSeenAt.getTime() > 10 * 60_000) {
        await this.prisma.user.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
      }
      if (existing.email !== claims.email) {
        await this.prisma.user.update({ where: { id: existing.id }, data: { email: claims.email } });
      }
      const platformRole = (await this.bootstrapOwner(existing.id, claims.email, existing.platformRole)) as typeof existing.platformRole;
      return { id: existing.id, email: claims.email, platformRole, personalOrgId };
    }

    // Idempotent under concurrency: a client's first page load fires several requests at once.
    const created = await this.prisma.user.createMany({ data: [{ id: claims.sub, email: claims.email }], skipDuplicates: true });
    if (created.count === 1) await this.audit.record({ action: 'auth.user_created', actorId: claims.sub, ip });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: claims.sub } });
    if (user.status !== 'active') throw new ForbiddenException('Account is not active');
    const personalOrgId = await this.createPersonalOrg(user.id, user.email);
    const platformRole = (await this.bootstrapOwner(user.id, user.email, user.platformRole)) as typeof user.platformRole;
    return { id: user.id, email: user.email, platformRole, personalOrgId };
  }

  private async createPersonalOrg(userId: string, email: string): Promise<string> {
    const base = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'workspace';
    const slug = `${base}-${userId.slice(0, 8)}`;
    let orgId: string;
    try {
      const org = await this.prisma.organization.create({
        data: { name: 'Personal workspace', slug, personal: true, memberships: { create: { userId, role: 'owner' } } },
      });
      orgId = org.id;
    } catch (e) {
      // Lost a race with a concurrent first request: use the org that request created.
      if ((e as { code?: string }).code !== 'P2002') throw e;
      orgId = (await this.prisma.organization.findUniqueOrThrow({ where: { slug } })).id;
    }
    await this.credits.ensureWorkspaceAllowance(orgId);
    return orgId;
  }
}
