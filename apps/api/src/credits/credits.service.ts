import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CreditBucket, Plan, Prisma, PrismaClient, SubscriptionEntitlement } from '@mya/db';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DEFAULT_PLANS } from '../billing/default-plans.js';

type Tx = Prisma.TransactionClient | PrismaClient;

export interface CreditBalances {
  allowance: number;
  purchased: number;
  /** Plan + purchased credits the workspace holds (pay-as-you-go usage is not included). */
  total: number;
  /** Pay-as-you-go credits used and not yet paid for. */
  owed: number;
}

/** Pay-as-you-go standing for a workspace: what a saved card lets it spend beyond its credits this month. */
export interface PaygState {
  /** A verified card is on file and payments are up to date. */
  active: boolean;
  status: 'none' | 'pending' | 'active' | 'past_due' | 'disabled';
  currency: string | null;
  monthlyCapMinor: number;
  /** Price of one credit, from the smallest active credit pack in this currency: credits per `rateMinor` minor units. */
  rate: { credits: number; priceMinor: number } | null;
  capCredits: number;
  usedThisMonth: number;
  headroom: number;
  owed: number;
  premiumAi: boolean;
}

/** Money for pay-as-you-go credits, rounded up to a whole minor unit. */
export const paygAmountMinor = (credits: number, rate: { credits: number; priceMinor: number }) => Math.ceil((credits * rate.priceMinor) / rate.credits);

const startOfMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonthsUtc = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));

/**
 * Credit ledger + entitlements. All writes are server-side, append-only and transactional;
 * no customer request can write the ledger or entitlements directly.
 *
 * Buckets: `allowance` (monthly plan credits; unused allowance expires at period end),
 * `purchased` (top-ups; never expire) and `payg` (pay-as-you-go usage owed, settled by verified card charges).
 * Spending consumes allowance first, then purchased, then pay-as-you-go up to the customer's monthly cap.
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
    return { allowance, purchased, total: allowance + purchased, owed: Math.max(0, -get('payg')) };
  }

  /** The price pay-as-you-go uses: the smallest active credit pack in that currency (the same price as a top-up). */
  async paygRate(currency: string, tx: Tx = this.prisma) {
    const pack = await tx.creditPack.findFirst({ where: { active: true, currency, credits: { gt: 0 }, priceMinor: { gt: 0 } }, orderBy: [{ credits: 'asc' }, { priceMinor: 'asc' }] });
    return pack ? { credits: pack.credits, priceMinor: pack.priceMinor } : null;
  }

  async paygState(organizationId: string, tx: Tx = this.prisma): Promise<PaygState> {
    const acct = await tx.paygAccount.findUnique({ where: { organizationId } });
    const monthStart = startOfMonthUtc(new Date());
    const [owedRow, usedRow, refundRow] = await Promise.all([
      tx.creditLedgerEntry.aggregate({ where: { organizationId, bucket: 'payg' }, _sum: { amount: true } }),
      tx.creditLedgerEntry.aggregate({ where: { organizationId, bucket: 'payg', reason: 'ai_usage', createdAt: { gte: monthStart } }, _sum: { amount: true } }),
      tx.creditLedgerEntry.aggregate({ where: { organizationId, bucket: 'payg', reason: 'refund', createdAt: { gte: monthStart } }, _sum: { amount: true } }),
    ]);
    const owed = Math.max(0, -(owedRow._sum.amount ?? 0));
    const usedThisMonth = Math.max(0, -(usedRow._sum.amount ?? 0) - (refundRow._sum.amount ?? 0));
    if (!acct) return { active: false, status: 'none', currency: null, monthlyCapMinor: 0, rate: null, capCredits: 0, usedThisMonth, headroom: 0, owed, premiumAi: false };
    const rate = await this.paygRate(acct.currency, tx);
    const capCredits = rate ? Math.floor((acct.monthlyCapMinor * rate.credits) / rate.priceMinor) : 0;
    const active = acct.status === 'active' && !!acct.providerToken && !!rate;
    return { active, status: acct.status, currency: acct.currency, monthlyCapMinor: acct.monthlyCapMinor, rate, capCredits, usedThisMonth, headroom: active ? Math.max(0, capCredits - usedThisMonth) : 0, owed, premiumAi: active && acct.premiumAi };
  }

  /** Credits the workspace can spend right now: what it holds plus any pay-as-you-go headroom. */
  async spendable(organizationId: string): Promise<{ balance: number; spendable: number; payg: PaygState }> {
    const balance = await this.balance(organizationId);
    const payg = await this.paygState(organizationId);
    return { balance, spendable: Math.max(0, balance) + payg.headroom, payg };
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
    const [used, refunded] = await Promise.all([
      this.prisma.creditLedgerEntry.aggregate({ where: { organizationId, reason: 'ai_usage', createdAt: { gte: since } }, _sum: { amount: true } }),
      // Credits given back by the failed-build guarantee don't count against today's limit: the customer got nothing.
      this.prisma.creditLedgerEntry.aggregate({ where: { organizationId, reason: 'refund', referenceType: 'generation_run', createdAt: { gte: since } }, _sum: { amount: true } }),
    ]);
    return Math.max(0, -(used._sum.amount ?? 0) - (refunded._sum.amount ?? 0));
  }

  async assertCanSpend(organizationId: string, needed: number) {
    const { balance: bal, spendable, payg } = await this.spendable(organizationId);
    if (spendable < needed) {
      const message = payg.status === 'past_due'
        ? `Not enough credits (balance ${bal}, needed ${needed}). Your last pay-as-you-go payment didn't go through: pay it on the Billing page to keep building.`
        : payg.active
          ? `You've reached this month's pay-as-you-go spending cap. Raise the cap on the Billing page, top up, or wait for next month.`
          : `Not enough credits (balance ${bal}, needed ${needed}). Top up, upgrade your plan, or add a card for pay-as-you-go.`;
      throw new HttpException({ message, balance: bal, code: payg.active ? 'payg_cap_reached' : 'insufficient_credits' }, HttpStatus.PAYMENT_REQUIRED);
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
    // With an active pay-as-you-go card, usage past plan and purchased credits is recorded as owed and charged later.
    // Without one, the (small, already budget-checked) overrun stays on the purchased bucket as before.
    const acct = await tx.paygAccount.findUnique({ where: { organizationId }, select: { status: true, providerToken: true } });
    const payg = acct?.status === 'active' && !!acct.providerToken;
    const fromPurchased = payg ? Math.max(0, Math.min(amount - fromAllowance, bal.purchased)) : amount - fromAllowance;
    const fromPayg = amount - fromAllowance - fromPurchased;
    const rows: Prisma.CreditLedgerEntryCreateManyInput[] = [];
    if (fromAllowance > 0) rows.push({ organizationId, amount: -fromAllowance, reason: 'ai_usage', bucket: 'allowance', idempotencyKey: `${idempotencyKey}:a`, referenceType: ref.type, referenceId: ref.id });
    if (fromPurchased > 0) rows.push({ organizationId, amount: -fromPurchased, reason: 'ai_usage', bucket: 'purchased', idempotencyKey: `${idempotencyKey}:p`, referenceType: ref.type, referenceId: ref.id });
    if (fromPayg > 0) rows.push({ organizationId, amount: -fromPayg, reason: 'ai_usage', bucket: 'payg', idempotencyKey: `${idempotencyKey}:g`, referenceType: ref.type, referenceId: ref.id });
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
