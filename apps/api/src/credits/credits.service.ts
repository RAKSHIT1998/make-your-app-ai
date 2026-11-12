import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CreditBucket, Plan, Prisma, PrismaClient, SubscriptionEntitlement } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DEFAULT_PLANS } from '../billing/default-plans.js';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface CreditBalances {
  allowance: number;
  purchased: number;
  total: number;
}

const startOfMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonthsUtc = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));

/**
 * Credit ledger + entitlements. All writes are server-side, append-only and transactional;
 * no customer request can write the ledger or entitlements directly.
 *
 * Buckets: `allowance` (monthly plan credits; unused allowance expires at period end) and
 * `purchased` (top-ups; never expire). Spending consumes allowance first.
 */
@Injectable()
export class CreditsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ───────── Plans bootstrap ─────────

  /** Seeds the default plan catalogue the first time it's needed. Owners edit plans afterwards in the admin console. */
  async ensureDefaultPlans(): Promise<void> {
    if ((await this.prisma.plan.count()) > 0) return;
    for (const p of DEFAULT_PLANS(this.config.FREE_PLAN_CREDITS)) {
      const { prices, ...plan } = p;
      await this.prisma.plan.upsert({ where: { code: plan.code }, update: {}, create: { ...plan, prices: { create: prices } } });
    }
    const packs = await this.prisma.creditPack.count();
    if (packs === 0) {
      await this.prisma.creditPack.createMany({
        data: [
          { name: '300 credits', credits: 300, priceMinor: 49_900, currency: 'INR', sortOrder: 1 },
          { name: '1,000 credits', credits: 1000, priceMinor: 149_900, currency: 'INR', sortOrder: 2 },
          { name: '300 credits', credits: 300, priceMinor: 600, currency: 'USD', sortOrder: 3 },
        ],
      });
    }
  }

  async freePlan(): Promise<Plan> {
    await this.ensureDefaultPlans();
    const free = await this.prisma.plan.findFirst({ where: { code: 'free' } });
    if (!free) throw new Error('Free plan is missing — restore the "free" plan in the admin console.');
    return free;
  }

  // ───────── Balances ─────────

  async balances(organizationId: string, tx: Tx = this.prisma): Promise<CreditBalances> {
    const rows = await tx.creditLedgerEntry.groupBy({ by: ['bucket'], where: { organizationId }, _sum: { amount: true } });
    const get = (b: CreditBucket) => rows.find((r) => r.bucket === b)?._sum.amount ?? 0;
    const allowance = get('allowance');
    const purchased = get('purchased');
    return { allowance, purchased, total: allowance + purchased };
  }

  async balance(organizationId: string, tx: Tx = this.prisma): Promise<number> {
    await this.rollFreePeriodIfDue(organizationId);
    return (await this.balances(organizationId, tx)).total;
  }

  creditsForCost(costMicros: number): number {
    return Math.ceil((costMicros * this.config.CREDITS_PER_USD) / 1_000_000);
  }

  /** Credits spent on AI since UTC midnight. */
  async spentToday(organizationId: string): Promise<number> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.creditLedgerEntry.aggregate({ where: { organizationId, reason: 'ai_usage', createdAt: { gte: since } }, _sum: { amount: true } });
    return -(agg._sum.amount ?? 0);
  }

  async assertCanSpend(organizationId: string, needed: number) {
    const bal = await this.balance(organizationId);
    if (bal < needed) {
      throw new HttpException({ message: `Not enough credits (balance ${bal}, needed ${needed}). Top up or upgrade your plan.`, balance: bal, code: 'insufficient_credits' }, HttpStatus.PAYMENT_REQUIRED);
    }
  }

  /** Idempotent ledger write (ON CONFLICT DO NOTHING on the idempotency key). */
  async grant(organizationId: string, amount: number, reason: 'plan_grant' | 'purchase' | 'adjustment' | 'refund' | 'referral', idempotencyKey: string, bucket: CreditBucket = 'allowance', tx: Tx = this.prisma, ref?: { type: string; id: string }) {
    await tx.creditLedgerEntry.createMany({
      data: [{ organizationId, amount, reason, idempotencyKey, bucket, referenceType: ref?.type ?? null, referenceId: ref?.id ?? null }],
      skipDuplicates: true,
    });
  }

  /** Debits inside the caller's transaction, allowance first, serialised per org with an advisory lock. */
  async debit(tx: Prisma.TransactionClient, organizationId: string, amount: number, idempotencyKey: string, ref: { type: string; id: string }) {
    if (amount <= 0) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
    const bal = await this.balances(organizationId, tx);
    const fromAllowance = Math.max(0, Math.min(amount, bal.allowance));
    const fromPurchased = amount - fromAllowance;
    const rows: Prisma.CreditLedgerEntryCreateManyInput[] = [];
    if (fromAllowance > 0) rows.push({ organizationId, amount: -fromAllowance, reason: 'ai_usage', bucket: 'allowance', idempotencyKey: `${idempotencyKey}:a`, referenceType: ref.type, referenceId: ref.id });
    if (fromPurchased > 0) rows.push({ organizationId, amount: -fromPurchased, reason: 'ai_usage', bucket: 'purchased', idempotencyKey: `${idempotencyKey}:p`, referenceType: ref.type, referenceId: ref.id });
    await tx.creditLedgerEntry.createMany({ data: rows, skipDuplicates: true });
  }

  // ───────── Entitlements ─────────

  async entitlement(organizationId: string): Promise<SubscriptionEntitlement> {
    await this.rollFreePeriodIfDue(organizationId);
    const e = await this.prisma.subscriptionEntitlement.findUnique({ where: { organizationId } });
    if (e) return e;
    await this.ensureWorkspaceAllowance(organizationId);
    return this.prisma.subscriptionEntitlement.findUniqueOrThrow({ where: { organizationId } });
  }

  /**
   * Sets the org's entitlements from a plan and starts a new allowance period:
   * expires whatever allowance is left, then grants the plan's monthly credits. Idempotent per period key.
   */
  async applyPlan(tx: Prisma.TransactionClient, organizationId: string, plan: Plan, source: 'free' | 'subscription' | 'admin', periodStart: Date, periodEnd: Date | null, periodKey: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
    const data = {
      planId: plan.id,
      source,
      monthlyCredits: plan.includedCredits,
      maxActiveProjects: plan.maxProjects,
      dailyCreditLimit: plan.dailyCreditLimit,
      maxCreditsPerRun: plan.maxCreditsPerRun,
      monthlyBuildCredits: plan.monthlyBuildCredits,
      teamSeats: plan.maxSeats,
      featureFlags: plan.featureFlags,
      projectTypes: plan.projectTypes,
      periodStart,
      periodEnd,
    };
    await tx.subscriptionEntitlement.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data } });
    const already = await tx.creditLedgerEntry.findUnique({ where: { idempotencyKey: `allowance:${organizationId}:${periodKey}` } });
    if (already) return;
    const { allowance } = await this.balances(organizationId, tx);
    if (allowance > 0) {
      await tx.creditLedgerEntry.create({ data: { organizationId, amount: -allowance, reason: 'expiry', bucket: 'allowance', idempotencyKey: `expire:${organizationId}:${periodKey}` } });
    }
    if (plan.includedCredits > 0) {
      await tx.creditLedgerEntry.create({ data: { organizationId, amount: plan.includedCredits, reason: 'plan_grant', bucket: 'allowance', idempotencyKey: `allowance:${organizationId}:${periodKey}`, referenceType: 'plan', referenceId: plan.id } });
    }
  }

  /** New workspaces start on the Free plan for the current calendar month. */
  async ensureWorkspaceAllowance(organizationId: string) {
    const existing = await this.prisma.subscriptionEntitlement.findUnique({ where: { organizationId } });
    if (existing) return;
    const free = await this.freePlan();
    const start = startOfMonthUtc(new Date());
    await this.prisma.$transaction((tx) => this.applyPlan(tx, organizationId, free, 'free', start, addMonthsUtc(start, 1), `free:${start.toISOString().slice(0, 7)}`));
  }

  /** Free workspaces renew lazily: the first request after the period ends starts a new month. */
  async rollFreePeriodIfDue(organizationId: string) {
    const e = await this.prisma.subscriptionEntitlement.findUnique({ where: { organizationId } });
    if (!e || e.source !== 'free' || !e.periodEnd || e.periodEnd > new Date()) return;
    const free = await this.freePlan();
    const start = startOfMonthUtc(new Date());
    await this.prisma.$transaction((tx) => this.applyPlan(tx, organizationId, free, 'free', start, addMonthsUtc(start, 1), `free:${start.toISOString().slice(0, 7)}`));
  }

  /** Reverts an org to the Free plan (subscription ended or halted). Never deletes projects. */
  async revertToFree(tx: Prisma.TransactionClient, organizationId: string, reasonKey: string) {
    const free = await tx.plan.findFirst({ where: { code: 'free' } });
    if (!free) throw new Error('Free plan missing');
    const start = new Date();
    await this.applyPlan(tx, organizationId, free, 'free', start, addMonthsUtc(start, 1), `revert:${reasonKey}`);
  }

  /** Projects that count against the plan limit. */
  activeProjectCount(organizationId: string) {
    return this.prisma.project.count({ where: { organizationId, deletedAt: null, status: { not: 'archived' } } });
  }
}
