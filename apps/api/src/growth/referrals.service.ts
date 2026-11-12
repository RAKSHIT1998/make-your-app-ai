import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { FlagsService } from '../flags/flags.service.js';

export const GrowthSettingsSchema = z.object({
  referralsEnabled: z.boolean(),
  referrerRewardCredits: z.number().int().min(0).max(10_000),
  referredRewardCredits: z.number().int().min(0).max(10_000),
  maxRewardsPerMonth: z.number().int().min(0).max(1000),
  claimWindowDays: z.number().int().min(1).max(90),
}).partial();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class ReferralsService {
  private readonly log = new Logger('Referrals');
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  settings() {
    return this.prisma.growthSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
  }

  async updateSettings(actor: AuthUser, input: z.infer<typeof GrowthSettingsSchema>) {
    await this.settings();
    const s = await this.prisma.growthSettings.update({ where: { id: 'default' }, data: input });
    await this.audit.record({ action: 'admin.growth_settings_updated', actorId: actor.id, targetType: 'growth_settings', targetId: 'default', metadata: input });
    return s;
  }

  async codeFor(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
    if (u.referralCode) return u.referralCode;
    for (let i = 0; i < 6; i++) {
      const code = [...randomBytes(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      const r = await this.prisma.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: code } }).catch(() => ({ count: 0 }));
      if (r.count) return code;
      const now = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
      if (now.referralCode) return now.referralCode;
    }
    throw new Error('Could not allocate a referral code');
  }

  async dashboard(user: AuthUser) {
    const [code, s, rows] = await Promise.all([
      this.codeFor(user.id),
      this.settings(),
      this.prisma.referral.findMany({ where: { referrerId: user.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { referred: { select: { email: true, displayName: true } } } }),
    ]);
    const mine = await this.prisma.referral.findUnique({ where: { referredUserId: user.id }, include: { referrer: { select: { displayName: true, handle: true } } } });
    return {
      code,
      enabled: s.referralsEnabled,
      rewards: { referrer: s.referrerRewardCredits, referred: s.referredRewardCredits, maxPerMonth: s.maxRewardsPerMonth },
      stats: {
        invited: rows.length,
        converted: rows.filter((r) => r.status === 'rewarded').length,
        creditsEarned: rows.reduce((n, r) => n + r.referrerCredits, 0),
      },
      referrals: rows.map((r) => ({ id: r.id, who: maskEmail(r.referred.email), name: r.referred.displayName, status: r.status, rejectReason: r.rejectReason, credits: r.referrerCredits, joinedAt: r.createdAt.toISOString(), qualifiedAt: r.qualifiedAt?.toISOString() ?? null })),
      referredBy: mine ? { name: mine.referrer.displayName ?? mine.referrer.handle ?? 'A creator', status: mine.status, credits: mine.referredCredits } : null,
    };
  }

  /**
   * Links a new account to a referrer. Nothing is rewarded here: rewards wait for the referred
   * user's first verified payment, so throwaway accounts earn nothing.
   */
  async claim(user: AuthUser, rawCode: string) {
    await this.flags.assert('referrals', 'The referral programme');
    const s = await this.settings();
    if (!s.referralsEnabled) throw new BadRequestException('The referral programme is paused.');
    const code = rawCode.trim().toUpperCase();
    const referrer = await this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true, status: true } });
    if (!referrer || referrer.status !== 'active') throw new NotFoundException('That invite code isn’t valid.');
    if (referrer.id === user.id) throw new BadRequestException('You can’t use your own invite code.');
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true } });
    if (Date.now() - me.createdAt.getTime() > s.claimWindowDays * 864e5) throw new BadRequestException(`Invite codes must be used within ${s.claimWindowDays} days of signing up.`);
    if (await this.prisma.referral.findUnique({ where: { referredUserId: user.id } })) throw new BadRequestException('Your account is already linked to an invite.');
    if (await this.prisma.referral.findFirst({ where: { referrerId: user.id, referredUserId: referrer.id } })) throw new BadRequestException('You can’t use the invite code of someone you invited.');
    if (await this.prisma.invoice.findFirst({ where: { organizationId: user.personalOrgId } })) throw new BadRequestException('Invite codes can only be used before your first payment.');
    await this.prisma.referral.createMany({ data: [{ referrerId: referrer.id, referredUserId: user.id }], skipDuplicates: true });
    await this.audit.record({ action: 'referral.claimed', actorId: user.id, targetType: 'user', targetId: referrer.id });
    return { linked: true };
  }

  /**
   * Called only from verified payment webhooks, after an invoice is recorded. The first paid invoice
   * of a referred user's personal workspace rewards both sides once (idempotent ledger keys).
   */
  async onPaidInvoice(organizationId: string) {
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { personal: true, memberships: { where: { role: 'owner' }, select: { userId: true }, take: 1 } } });
      const userId = org?.personal ? org.memberships[0]?.userId : undefined;
      if (!userId) return;
      const ref = await this.prisma.referral.findUnique({ where: { referredUserId: userId }, include: { referrer: { select: { status: true, memberships: { where: { organization: { personal: true } }, select: { organizationId: true } } } } } });
      if (!ref || ref.status !== 'pending') return;
      const s = await this.settings();
      if (!s.referralsEnabled) return; // stays pending; rewarded if the programme resumes and they pay again
      const invoice = await this.prisma.invoice.findFirst({ where: { organizationId }, orderBy: { paidAt: 'asc' }, select: { id: true } });
      const reject = async (reason: string) => {
        await this.prisma.referral.update({ where: { id: ref.id }, data: { status: 'rejected', rejectReason: reason, qualifiedAt: new Date(), invoiceId: invoice?.id ?? null } });
        await this.audit.record({ action: 'referral.rejected', targetType: 'referral', targetId: ref.id, metadata: { reason } });
      };
      if (ref.referrer.status !== 'active') return reject('referrer_inactive');
      const referrerOrg = ref.referrer.memberships[0]?.organizationId;
      if (!referrerOrg) return reject('referrer_no_workspace');
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const thisMonth = await this.prisma.referral.count({ where: { referrerId: ref.referrerId, status: 'rewarded', qualifiedAt: { gte: monthStart } } });
      if (thisMonth >= s.maxRewardsPerMonth) return reject('monthly_cap');

      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.referral.updateMany({ where: { id: ref.id, status: 'pending' }, data: { status: 'rewarded', qualifiedAt: new Date(), invoiceId: invoice?.id ?? null, referrerCredits: s.referrerRewardCredits, referredCredits: s.referredRewardCredits } });
        if (!claimed.count) return;
        if (s.referrerRewardCredits > 0) await this.credits.grant(referrerOrg, s.referrerRewardCredits, 'referral', `referral:${ref.id}:referrer`, 'purchased', tx, { type: 'referral', id: ref.id });
        if (s.referredRewardCredits > 0) await this.credits.grant(organizationId, s.referredRewardCredits, 'referral', `referral:${ref.id}:referred`, 'purchased', tx, { type: 'referral', id: ref.id });
      });
      await this.audit.record({ action: 'referral.rewarded', targetType: 'referral', targetId: ref.id, metadata: { referrer: s.referrerRewardCredits, referred: s.referredRewardCredits } });
    } catch (e) {
      // Never fail a payment webhook because of referral bookkeeping.
      this.log.error(`referral reward failed for org ${organizationId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  async adminSummary() {
    const [settings, byStatus, recent] = await Promise.all([
      this.settings(),
      this.prisma.referral.groupBy({ by: ['status'], _count: true }),
      this.prisma.referral.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { referrer: { select: { email: true } }, referred: { select: { email: true } } } }),
    ]);
    return {
      settings,
      counts: Object.fromEntries(byStatus.map((b) => [b.status, b._count])),
      recent: recent.map((r) => ({ id: r.id, referrer: r.referrer.email, referred: r.referred.email, status: r.status, rejectReason: r.rejectReason, createdAt: r.createdAt.toISOString(), qualifiedAt: r.qualifiedAt?.toISOString() ?? null, credits: r.referrerCredits + r.referredCredits })),
    };
  }
}

function maskEmail(e: string) {
  const [u, d] = e.split('@');
  return `${u!.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, u!.length - 2)))}@${d}`;
}
