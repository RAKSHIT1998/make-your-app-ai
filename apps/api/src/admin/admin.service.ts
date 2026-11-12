import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@mya/db';
import { z } from 'zod';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import type { AuthUser } from '../auth/auth.types.js';

export const PlanInput = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,32}$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).default(''),
  sortOrder: z.number().int().default(0),
  includedCredits: z.number().int().min(0).max(10_000_000),
  maxProjects: z.number().int().min(0).max(100_000),
  maxSeats: z.number().int().min(1).max(10_000).default(1),
  maxOrgs: z.number().int().min(1).max(10_000).default(1),
  dailyCreditLimit: z.number().int().min(1).nullable().default(null),
  maxCreditsPerRun: z.number().int().min(1).max(1_000_000).default(500),
  monthlyBuildCredits: z.number().int().min(0).default(0),
  featureFlags: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(50).default([]),
  projectTypes: z.array(z.enum(['mobile_app', 'website', 'ecommerce', 'business_website', 'saas', 'custom_software'])).default([]),
  active: z.boolean().default(true),
  public: z.boolean().default(true),
});
export const PlanUpdate = PlanInput.omit({ code: true }).partial();
export const PriceInput = z.object({
  interval: z.enum(['monthly', 'yearly']),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: z.number().int().min(0).max(100_000_000),
  stripePriceId: z.string().regex(/^price_/).optional(),
});
export const PriceUpdate = z.object({ active: z.boolean(), stripePriceId: z.string().regex(/^price_/).nullable() }).partial();
export const PackInput = z.object({ name: z.string().trim().min(1).max(60), credits: z.number().int().min(1).max(10_000_000), priceMinor: z.number().int().min(1), currency: z.string().regex(/^[A-Z]{3}$/), active: z.boolean().default(true), sortOrder: z.number().int().default(0) });
export const PackUpdate = PackInput.partial();
export const CreditAdjust = z.object({ amount: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0), bucket: z.enum(['allowance', 'purchased']).default('purchased'), reason: z.string().trim().min(3).max(300), idempotencyKey: z.string().min(8).max(100) });

const MONTHLY = (interval: string, amount: number) => (interval === 'yearly' ? amount / 12 : amount);

/** Owner console. Every method is behind PlatformAdminGuard; every mutation is audited. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CreditsService) private readonly credits: CreditsService,
  ) {}

  async overview(days: number) {
    const since = new Date(Date.now() - days * 864e5);
    const [users, newUsers, activeUsers, activeSubs, revenue, aiCost, runs, cancellations, paymentFailures, projects] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: 'deleted' } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: since } } }),
      this.prisma.subscription.findMany({ where: { status: { in: ['active', 'past_due'] } }, include: { price: true, plan: true } }),
      this.prisma.invoice.groupBy({ by: ['currency'], where: { paidAt: { gte: since } }, _sum: { totalMinor: true, refundedMinor: true, feeMinor: true }, _count: true }),
      this.prisma.aiUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { costMicros: true, inputTokens: true, outputTokens: true } }),
      this.prisma.generationRun.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.subscription.count({ where: { endedAt: { gte: since } } }),
      this.prisma.subscription.count({ where: { status: { in: ['past_due', 'halted'] } } }),
      this.prisma.project.count({ where: { deletedAt: null } }),
    ]);
    const mrr: Record<string, number> = {};
    const byPlan: Record<string, number> = {};
    for (const s of activeSubs) {
      byPlan[s.plan.code] = (byPlan[s.plan.code] ?? 0) + 1;
      if (s.price) mrr[s.price.currency] = (mrr[s.price.currency] ?? 0) + Math.round(MONTHLY(s.price.interval, s.price.amountMinor));
    }
    const aiCostUsd = Number(aiCost._sum.costMicros ?? 0n) / 1e6;
    const revenueInr = revenue.find((r) => r.currency === 'INR');
    const netInrMinor = revenueInr ? (revenueInr._sum.totalMinor ?? 0) - (revenueInr._sum.refundedMinor ?? 0) - (revenueInr._sum.feeMinor ?? 0) : 0;
    const fx = this.config.REPORTING_USD_INR;
    return {
      days,
      users: { total: users, new: newUsers, active: activeUsers },
      subscriptions: { active: activeSubs.length, byPlan, cancellationsInPeriod: cancellations, paymentProblems: paymentFailures },
      mrrMinor: mrr,
      arrMinor: Object.fromEntries(Object.entries(mrr).map(([k, v]) => [k, v * 12])),
      revenue: revenue.map((r) => ({ currency: r.currency, grossMinor: r._sum.totalMinor ?? 0, refundsMinor: r._sum.refundedMinor ?? 0, feesMinor: r._sum.feeMinor ?? 0, invoices: r._count })),
      ai: { costUsd: Math.round(aiCostUsd * 100) / 100, inputTokens: aiCost._sum.inputTokens ?? 0, outputTokens: aiCost._sum.outputTokens ?? 0 },
      generations: Object.fromEntries(runs.map((r) => [r.status, r._count])),
      projects,
      grossMarginInr: fx ? { netRevenueMinor: netInrMinor, aiCostMinor: Math.round(aiCostUsd * fx * 100), marginMinor: netInrMinor - Math.round(aiCostUsd * fx * 100) } : null,
      notes: fx ? [] : ['Set REPORTING_USD_INR to see gross margin (AI costs are in USD, revenue in INR).', 'Sandbox, storage, hosting and bandwidth costs are not metered yet.'],
    };
  }

  // ───────── Plans & pricing ─────────

  async plans() {
    await this.credits.ensureDefaultPlans();
    const plans = await this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { prices: { orderBy: [{ currency: 'asc' }, { interval: 'asc' }] }, _count: { select: { subscriptions: { where: { status: { in: ['active', 'past_due'] } } } } } } });
    return plans.map(({ _count, ...p }) => ({ ...p, activeSubscriptions: _count.subscriptions }));
  }

  async createPlan(admin: AuthUser, input: z.infer<typeof PlanInput>) {
    const plan = await this.prisma.plan.create({ data: input }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A plan with that code exists.');
      throw e;
    });
    await this.audit.record({ action: 'admin.plan_created', actorId: admin.id, targetType: 'plan', targetId: plan.id, metadata: input as Prisma.InputJsonValue });
    return plan;
  }

  async updatePlan(admin: AuthUser, id: string, input: z.infer<typeof PlanUpdate>) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plan not found');
    if (before.code === 'free' && input.active === false) throw new BadRequestException('The free plan cannot be deactivated (it is the fallback for expired subscriptions).');
    const plan = await this.prisma.plan.update({ where: { id }, data: input });
    await this.audit.record({ action: 'admin.plan_updated', actorId: admin.id, targetType: 'plan', targetId: id, metadata: { changes: input } as Prisma.InputJsonValue });
    return plan;
  }

  /** Prices are immutable once created (existing subscribers keep theirs). */
  async addPrice(admin: AuthUser, planId: string, input: z.infer<typeof PriceInput>) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const existing = await this.prisma.planPrice.findUnique({ where: { planId_interval_currency: { planId, interval: input.interval, currency: input.currency } } });
    if (existing && existing.amountMinor !== input.amountMinor) {
      throw new ConflictException('Prices are immutable so existing subscribers keep what they signed up for. Create a new plan version (e.g. code "pro_v2") with the new price, then hide the old plan.');
    }
    const price = existing
      ? await this.prisma.planPrice.update({ where: { id: existing.id }, data: { active: true, ...(input.stripePriceId ? { stripePriceId: input.stripePriceId } : {}) } })
      : await this.prisma.planPrice.create({ data: { planId, ...input } });
    await this.audit.record({ action: 'admin.price_set', actorId: admin.id, targetType: 'plan_price', targetId: price.id, metadata: input as Prisma.InputJsonValue });
    return price;
  }

  async updatePrice(admin: AuthUser, priceId: string, input: z.infer<typeof PriceUpdate>) {
    const price = await this.prisma.planPrice.update({ where: { id: priceId }, data: input }).catch(() => {
      throw new NotFoundException('Price not found');
    });
    await this.audit.record({ action: 'admin.price_updated', actorId: admin.id, targetType: 'plan_price', targetId: priceId, metadata: input as Prisma.InputJsonValue });
    return price;
  }

  async packs() {
    return this.prisma.creditPack.findMany({ orderBy: { sortOrder: 'asc' } });
  }
  async createPack(admin: AuthUser, input: z.infer<typeof PackInput>) {
    const p = await this.prisma.creditPack.create({ data: input });
    await this.audit.record({ action: 'admin.credit_pack_created', actorId: admin.id, targetType: 'credit_pack', targetId: p.id, metadata: input as Prisma.InputJsonValue });
    return p;
  }
  async updatePack(admin: AuthUser, id: string, input: z.infer<typeof PackUpdate>) {
    const p = await this.prisma.creditPack.update({ where: { id }, data: input }).catch(() => {
      throw new NotFoundException('Credit pack not found');
    });
    await this.audit.record({ action: 'admin.credit_pack_updated', actorId: admin.id, targetType: 'credit_pack', targetId: id, metadata: input as Prisma.InputJsonValue });
    return p;
  }

  // ───────── Customers ─────────

  async users(q: string | undefined, limit: number) {
    const users = await this.prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { memberships: { where: { organization: { personal: true } }, include: { organization: { include: { entitlement: { include: { plan: true } }, subscription: true } } } } },
    });
    const orgIds = users.flatMap((u) => u.memberships.map((m) => m.organizationId));
    const [cost, revenue, projects] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ['organizationId'], where: { organizationId: { in: orgIds } }, _sum: { costMicros: true } }),
      this.prisma.invoice.groupBy({ by: ['organizationId', 'currency'], where: { organizationId: { in: orgIds } }, _sum: { totalMinor: true, refundedMinor: true } }),
      this.prisma.project.groupBy({ by: ['organizationId'], where: { organizationId: { in: orgIds }, deletedAt: null }, _count: true }),
    ]);
    return users.map((u) => {
      const org = u.memberships[0]?.organization;
      const id = org?.id;
      return {
        id: u.id, email: u.email, displayName: u.displayName, status: u.status, platformRole: u.platformRole, createdAt: u.createdAt.toISOString(),
        organizationId: id ?? null,
        plan: org?.entitlement?.plan.code ?? 'free',
        subscriptionStatus: org?.subscription?.status ?? null,
        projects: projects.find((p) => p.organizationId === id)?._count ?? 0,
        aiCostUsd: Math.round(Number(cost.find((c) => c.organizationId === id)?._sum.costMicros ?? 0n) / 1e4) / 100,
        revenue: revenue.filter((r) => r.organizationId === id).map((r) => ({ currency: r.currency, netMinor: (r._sum.totalMinor ?? 0) - (r._sum.refundedMinor ?? 0) })),
      };
    });
  }

  async setUserStatus(admin: AuthUser, userId: string, status: 'active' | 'suspended', reason: string) {
    if (userId === admin.id) throw new BadRequestException('You cannot change your own account status.');
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    if (u.platformRole === 'superadmin' && admin.platformRole !== 'superadmin') throw new BadRequestException('Only a superadmin can change another superadmin.');
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    await this.audit.record({ action: status === 'suspended' ? 'admin.user_suspended' : 'admin.user_restored', actorId: admin.id, targetType: 'user', targetId: userId, metadata: { reason } });
    return { id: userId, status };
  }

  async adjustCredits(admin: AuthUser, organizationId: string, input: z.infer<typeof CreditAdjust>) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
      if (input.amount < 0) {
        const bal = await this.credits.balances(organizationId, tx);
        if (bal[input.bucket] + input.amount < 0) throw new BadRequestException(`Adjustment would make the ${input.bucket} balance negative.`);
      }
      await this.credits.grant(organizationId, input.amount, 'adjustment', `admin:${input.idempotencyKey}`, input.bucket, tx, { type: 'admin', id: admin.id });
    });
    await this.audit.record({ action: 'admin.credits_adjusted', actorId: admin.id, organizationId, targetType: 'organization', targetId: organizationId, metadata: { amount: input.amount, bucket: input.bucket, reason: input.reason } });
    return this.credits.balances(organizationId);
  }

  async auditLog(limit: number) {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: limit, include: { actor: { select: { email: true } } } });
    return rows.map((r) => ({ id: r.id.toString(), action: r.action, actor: r.actor?.email ?? null, organizationId: r.organizationId, targetType: r.targetType, targetId: r.targetId, metadata: r.metadata, createdAt: r.createdAt.toISOString() }));
  }
}
