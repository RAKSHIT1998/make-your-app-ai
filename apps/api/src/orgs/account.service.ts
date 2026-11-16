import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import type { AuthUser } from '../auth/auth.types.js';
import { BillingService } from '../billing/billing.service.js';

export const ACCOUNT_FETCH = Symbol('ACCOUNT_FETCH');
export const accountFetchProvider = { provide: ACCOUNT_FETCH, useValue: (...a: Parameters<typeof fetch>) => fetch(...a) };

export const DeleteAccountSchema = z.object({ confirmEmail: z.string().trim().min(3).max(320) });

const LIVE_SUBSCRIPTION = ['active', 'trialing', 'past_due'];

/**
 * Self-service account deletion (App Store guideline 5.1.1(v), Play's account-deletion policy, and plain good manners).
 * What goes: the person's profile and sign-in, their personal workspace and any team workspace they are the only member
 * of (projects deleted and taken offline, shops paused, pay-as-you-go switched off, subscription renewals cancelled),
 * their likes, follows, votes, comments and collections, and their membership of other teams.
 * What stays, without anything that identifies them: invoices and payment records (tax law), audit entries, and orders
 * that customers placed in their shops. Hosted sites deployed to an outside host are not taken down automatically.
 */
@Injectable()
export class AccountService {
  private readonly log = new Logger(AccountService.name);
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(ACCOUNT_FETCH) private readonly f: typeof fetch,
  ) {}

  /** What deleting would do, so the confirm screen can say it plainly before anything happens. */
  async preview(user: AuthUser) {
    const { closing, blockers } = await this.plan(user);
    const projects = closing.length ? await this.prisma.project.count({ where: { organizationId: { in: closing.map((o) => o.id) }, deletedAt: null } }) : 0;
    const subs = closing.length ? await this.prisma.subscription.findMany({ where: { organizationId: { in: closing.map((o) => o.id) }, status: { in: LIVE_SUBSCRIPTION as never } }, select: { cancelAtPeriodEnd: true } }) : [];
    return {
      workspaces: closing.map((o) => ({ id: o.id, name: o.name, personal: o.personal })),
      projects,
      subscriptionsToCancel: subs.filter((s) => !s.cancelAtPeriodEnd).length,
      blockers,
    };
  }

  async delete(user: AuthUser, body: z.infer<typeof DeleteAccountSchema>, ip: string | null) {
    if (body.confirmEmail.toLowerCase() !== user.email.toLowerCase()) throw new BadRequestException('Type the email address you sign in with to confirm.');
    const { closing, blockers } = await this.plan(user);
    if (blockers.length) throw new ConflictException(blockers[0]);
    const orgIds = closing.map((o) => o.id);

    // Stop future charges first: if a provider call fails, nothing has been deleted yet and the person can retry.
    const subs = orgIds.length ? await this.prisma.subscription.findMany({ where: { organizationId: { in: orgIds }, status: { in: LIVE_SUBSCRIPTION as never }, cancelAtPeriodEnd: false, providerSubscriptionId: { not: null } } }) : [];
    for (const s of subs) await this.billing.cancel(user, s.organizationId);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (orgIds.length) {
        await tx.project.updateMany({ where: { organizationId: { in: orgIds }, deletedAt: null }, data: { deletedAt: now, status: 'archived', visibility: 'private' } });
        await tx.store.updateMany({ where: { organizationId: { in: orgIds }, status: 'active' }, data: { status: 'paused' } });
        await tx.paygAccount.updateMany({ where: { organizationId: { in: orgIds } }, data: { status: 'disabled', premiumAi: false } });
        await tx.organization.updateMany({ where: { id: { in: orgIds } }, data: { name: 'Deleted workspace' } });
      }
      // Votes are counted on the entry; take this person's votes back out of the totals before removing them.
      await tx.$executeRaw`UPDATE "ChallengeEntry" e SET "voteCount" = GREATEST(0, e."voteCount" - v.n)
        FROM (SELECT "entryId", COUNT(*)::int AS n FROM "ChallengeVote" WHERE "userId" = ${user.id}::uuid GROUP BY "entryId") v
        WHERE e.id = v."entryId"`;
      await tx.challengeVote.deleteMany({ where: { userId: user.id } });
      await tx.projectLike.deleteMany({ where: { userId: user.id } });
      await tx.userFollow.deleteMany({ where: { OR: [{ followerId: user.id }, { followedId: user.id }] } });
      await tx.projectComment.deleteMany({ where: { authorId: user.id } });
      await tx.showcaseCollection.deleteMany({ where: { ownerId: user.id } });
      await tx.organizationMembership.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { status: 'deleted', email: `deleted+${user.id}@deleted.invalid`, displayName: null, avatarUrl: null, handle: null, bio: '', referralCode: null, platformRole: 'user' },
      });
    });

    const signInRemoved = await this.removeSignIn(user.id);
    await this.audit.record({ action: 'account.deleted', actorId: user.id, ip, targetType: 'user', targetId: user.id, metadata: { workspacesClosed: orgIds.length, subscriptionsCancelled: subs.length, signInRemoved } });
    return { deleted: true, workspacesClosed: orgIds.length, subscriptionsCancelled: subs.length, signInRemoved };
  }

  /** Workspaces that close with the account, and anything that must be sorted out first. */
  private async plan(user: AuthUser) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId: user.id },
      include: { organization: { select: { id: true, name: true, personal: true, memberships: { select: { userId: true, role: true } } } } },
    });
    const closing: { id: string; name: string; personal: boolean }[] = [];
    const blockers: string[] = [];
    for (const m of memberships) {
      const o = m.organization;
      const others = o.memberships.filter((x) => x.userId !== user.id);
      if (o.personal || others.length === 0) {
        closing.push({ id: o.id, name: o.name, personal: o.personal });
        continue;
      }
      if (m.role === 'owner' && !others.some((x) => x.role === 'owner')) {
        blockers.push(`You're the only owner of "${o.name}". Make another member an owner, or remove its members, before deleting your account.`);
      }
    }
    return { closing, blockers };
  }

  /** Deletes the Supabase sign-in when the service-role key is configured; otherwise the account stays blocked here. */
  private async removeSignIn(userId: string): Promise<boolean> {
    const url = this.config.SUPABASE_URL;
    const key = this.config.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return false;
    try {
      const res = await this.f(`${url.replace(/\/$/, '')}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (res.ok || res.status === 404) return true;
      this.log.warn(`Supabase refused to delete sign-in for ${userId}: HTTP ${res.status}`);
    } catch (e) {
      this.log.warn(`Supabase sign-in deletion failed for ${userId}: ${(e as Error).message}`);
    }
    return false;
  }
}
