import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type PaymentProvider, type PrismaClient } from '@mya/db';
import { GatewayError, RazorpayBilling, StripeBilling, WebhookSignatureError, type BillingEvent, type BillingProvider } from '@mya/payments';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { CreditsService } from '../credits/credits.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';

export const BILLING_PROVIDERS = Symbol('BILLING_PROVIDERS');
export type BillingProviders = Partial<Record<PaymentProvider, BillingProvider>>;

/** Builds the platform's billing providers from env. A provider without credentials is simply absent ("setup required"). */
export const billingProvidersFactory = {
  provide: BILLING_PROVIDERS,
  inject: [APP_CONFIG],
  useFactory: (c: AppConfig): BillingProviders => ({
    ...(c.RAZORPAY_KEY_ID && c.RAZORPAY_KEY_SECRET && c.RAZORPAY_WEBHOOK_SECRET ? { razorpay: new RazorpayBilling({ keyId: c.RAZORPAY_KEY_ID, keySecret: c.RAZORPAY_KEY_SECRET, webhookSecret: c.RAZORPAY_WEBHOOK_SECRET }) } : {}),
    ...(c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET ? { stripe: new StripeBilling({ secretKey: c.STRIPE_SECRET_KEY, webhookSecret: c.STRIPE_WEBHOOK_SECRET }) } : {}),
  }),
};

/** INR is charged through Razorpay; other currencies through Stripe. */
const providerFor = (currency: string): PaymentProvider => (currency === 'INR' ? 'razorpay' : 'stripe');

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BILLING_PROVIDERS) private readonly providers: BillingProviders,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private provider(name: PaymentProvider): BillingProvider {
    const p = this.providers[name];
    if (!p) throw new HttpException({ message: `Payments via ${name} are not configured on this server yet.`, setupRequired: true }, HttpStatus.SERVICE_UNAVAILABLE);
    return p;
  }

  // ───────── Catalogue ─────────

  async catalogue() {
    await this.credits.ensureDefaultPlans();
    const [plans, packs] = await Promise.all([
      this.prisma.plan.findMany({ where: { active: true, public: true }, orderBy: { sortOrder: 'asc' }, include: { prices: { where: { active: true }, orderBy: { amountMinor: 'asc' } } } }),
      this.prisma.creditPack.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    return {
      plans: plans.map((p) => ({
        id: p.id, code: p.code, name: p.name, description: p.description, monthlyCredits: p.includedCredits, maxActiveProjects: p.maxProjects,
        teamSeats: p.maxSeats, dailyCreditLimit: p.dailyCreditLimit, monthlyBuildCredits: p.monthlyBuildCredits, featureFlags: p.featureFlags, projectTypes: p.projectTypes,
        prices: p.prices.map((x) => ({ id: x.id, interval: x.interval, currency: x.currency, amountMinor: x.amountMinor })),
      })),
      creditPacks: packs.map((c) => ({ id: c.id, name: c.name, credits: c.credits, priceMinor: c.priceMinor, currency: c.currency })),
      providers: { razorpay: !!this.providers.razorpay, stripe: !!this.providers.stripe },
    };
  }

  // ───────── Customer billing overview ─────────

  async overview(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'viewer');
    const ent = await this.credits.entitlement(orgId);
    const [plan, sub, balances, spentToday, activeProjects, invoices, periodUsage] = await Promise.all([
      this.prisma.plan.findUniqueOrThrow({ where: { id: ent.planId } }),
      this.prisma.subscription.findUnique({ where: { organizationId: orgId }, include: { price: true, plan: true } }),
      this.credits.balances(orgId),
      this.credits.spentToday(orgId),
      this.credits.activeProjectCount(orgId),
      this.prisma.invoice.findMany({ where: { organizationId: orgId }, orderBy: { paidAt: 'desc' }, take: 24 }),
      this.prisma.creditLedgerEntry.aggregate({ where: { organizationId: orgId, reason: 'ai_usage', createdAt: { gte: ent.periodStart } }, _sum: { amount: true } }),
    ]);
    return {
      organizationId: orgId,
      plan: { code: plan.code, name: plan.name, source: ent.source },
      entitlements: { monthlyCredits: ent.monthlyCredits, maxActiveProjects: ent.maxActiveProjects, dailyCreditLimit: ent.dailyCreditLimit, maxCreditsPerRun: ent.maxCreditsPerRun, teamSeats: ent.teamSeats, featureFlags: ent.featureFlags, projectTypes: ent.projectTypes },
      period: { start: ent.periodStart.toISOString(), end: ent.periodEnd?.toISOString() ?? null },
      subscription: sub && ['active', 'past_due', 'trialing'].includes(sub.status)
        ? { id: sub.id, status: sub.status, provider: sub.provider, interval: sub.price?.interval ?? null, amountMinor: sub.price?.amountMinor ?? null, currency: sub.price?.currency ?? null, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: sub.cancelAtPeriodEnd }
        : null,
      credits: { allowanceRemaining: balances.allowance, purchasedRemaining: balances.purchased, total: balances.total, usedThisPeriod: -(periodUsage._sum.amount ?? 0), usedToday: spentToday },
      usage: { activeProjects },
      invoices: invoices.map((i) => ({ id: i.id, number: i.number, description: i.description, currency: i.currency, totalMinor: i.totalMinor, refundedMinor: i.refundedMinor, status: i.status, paidAt: i.paidAt.toISOString() })),
    };
  }

  /** Credit ledger history for the workspace (most recent first). */
  async usage(user: AuthUser, organizationId: string | undefined, limit: number) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'viewer');
    const rows = await this.prisma.creditLedgerEntry.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: limit });
    const runIds = [...new Set(rows.filter((r) => r.referenceType === 'ai_usage' && r.referenceId).map((r) => r.referenceId!))];
    const usage = runIds.length ? await this.prisma.aiUsage.findMany({ where: { id: { in: runIds } }, select: { id: true, agent: true, model: true, run: { select: { project: { select: { name: true } } } } } }) : [];
    const byId = new Map(usage.map((u) => [u.id, u]));
    return rows.map((r) => {
      const u = r.referenceId ? byId.get(r.referenceId) : undefined;
      return { id: r.id, amount: r.amount, reason: r.reason, bucket: r.bucket, createdAt: r.createdAt.toISOString(), detail: u ? `${u.agent ?? 'AI'} · ${u.run?.project.name ?? 'project'}` : null };
    });
  }

  // ───────── Checkout ─────────

  private urls(checkoutId: string) {
    const base = this.config.WEB_APP_URL.replace(/\/$/, '');
    return { successUrl: `${base}/billing?checkout=${checkoutId}`, cancelUrl: `${base}/billing?checkout=${checkoutId}&cancelled=1` };
  }

  async startSubscription(user: AuthUser, planPriceId: string, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'owner');
    const price = await this.prisma.planPrice.findFirst({ where: { id: planPriceId, active: true, plan: { active: true } }, include: { plan: true } });
    if (!price) throw new NotFoundException('That plan is not available.');
    if (price.amountMinor === 0) throw new BadRequestException('The Free plan needs no checkout.');
    const current = await this.prisma.subscription.findUnique({ where: { organizationId: orgId } });
    if (current && current.priceId === price.id && ['active', 'past_due'].includes(current.status)) throw new ConflictException('You are already on this plan.');

    const providerName = providerFor(price.currency);
    const provider = this.provider(providerName);
    let ref: string;
    try {
      ref = await provider.ensurePlan({ planName: `${price.plan.name} (${price.interval})`, interval: price.interval, amountMinor: price.amountMinor, currency: price.currency, existingRef: providerName === 'razorpay' ? price.razorpayPlanId : price.stripePriceId });
      if (providerName === 'razorpay' && !price.razorpayPlanId) await this.prisma.planPrice.update({ where: { id: price.id }, data: { razorpayPlanId: ref } });
    } catch (e) {
      throw this.gatewayFailure(e);
    }
    const checkoutId = crypto.randomUUID();
    let result;
    try {
      result = await provider.createSubscriptionCheckout({ providerPlanRef: ref, interval: price.interval, checkoutId, organizationId: orgId, email: user.email, ...this.urls(checkoutId) });
    } catch (e) {
      throw this.gatewayFailure(e);
    }
    await this.prisma.billingCheckout.create({
      data: { id: checkoutId, organizationId: orgId, createdById: user.id, kind: 'subscription', provider: providerName, providerRef: result.providerRef, planPriceId: price.id, amountMinor: price.amountMinor, currency: price.currency, clientParams: result.clientParams },
    });
    await this.audit.record({ action: 'billing.checkout_started', actorId: user.id, organizationId: orgId, targetType: 'billing_checkout', targetId: checkoutId, metadata: { plan: price.plan.code, interval: price.interval } });
    return { checkoutId, ...result.clientParams };
  }

  async startTopup(user: AuthUser, creditPackId: string, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'admin');
    const pack = await this.prisma.creditPack.findFirst({ where: { id: creditPackId, active: true } });
    if (!pack) throw new NotFoundException('That credit pack is not available.');
    const providerName = providerFor(pack.currency);
    const provider = this.provider(providerName);
    const checkoutId = crypto.randomUUID();
    let result;
    try {
      result = await provider.createTopupCheckout({ amountMinor: pack.priceMinor, currency: pack.currency, description: `Make Your App AI — ${pack.name}`, checkoutId, organizationId: orgId, email: user.email, ...this.urls(checkoutId) });
    } catch (e) {
      throw this.gatewayFailure(e);
    }
    await this.prisma.billingCheckout.create({
      data: { id: checkoutId, organizationId: orgId, createdById: user.id, kind: 'topup', provider: providerName, providerRef: result.providerRef, creditPackId: pack.id, amountMinor: pack.priceMinor, currency: pack.currency, clientParams: result.clientParams },
    });
    return { checkoutId, ...result.clientParams };
  }

  /** Customers poll this after paying. Status only changes through verified webhooks. */
  async checkoutStatus(user: AuthUser, checkoutId: string) {
    const c = await this.prisma.billingCheckout.findUnique({ where: { id: checkoutId } });
    if (!c) throw new NotFoundException('Checkout not found');
    await this.orgs.assertRole(user.id, c.organizationId, 'viewer').catch(() => {
      throw new NotFoundException('Checkout not found');
    });
    return { id: c.id, kind: c.kind, status: c.status, completedAt: c.completedAt?.toISOString() ?? null };
  }

  async cancel(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'owner');
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId: orgId } });
    if (!sub || !sub.providerSubscriptionId || !sub.provider || !['active', 'past_due'].includes(sub.status)) throw new BadRequestException('There is no active paid subscription to cancel.');
    if (sub.cancelAtPeriodEnd) return { cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null };
    try {
      await this.provider(sub.provider).cancelSubscription(sub.providerSubscriptionId, true);
    } catch (e) {
      throw this.gatewayFailure(e);
    }
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    await this.audit.record({ action: 'billing.cancel_scheduled', actorId: user.id, organizationId: orgId, targetType: 'subscription', targetId: sub.id });
    return { cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null };
  }

  private gatewayFailure(e: unknown) {
    if (e instanceof HttpException) return e;
    const msg = e instanceof GatewayError ? e.message : 'payment provider error';
    this.log.warn(`billing gateway failure: ${msg}`);
    return new HttpException({ message: `Could not start the payment: ${msg}` }, HttpStatus.BAD_GATEWAY);
  }

  // ───────── Webhooks (the ONLY path that grants paid entitlements or purchased credits) ─────────

  async handleWebhook(providerName: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    if (providerName !== 'razorpay' && providerName !== 'stripe') throw new NotFoundException();
    const provider = this.providers[providerName];
    if (!provider) throw new NotFoundException();
    if (!rawBody) throw new BadRequestException('Missing body');
    let evt: BillingEvent;
    try {
      evt = provider.parseWebhook(rawBody, headers);
    } catch (e) {
      if (e instanceof WebhookSignatureError) throw new BadRequestException('Invalid signature');
      throw e;
    }
    const eventKey = `billing:${evt.eventId}`;
    try {
      await this.prisma.paymentWebhookEvent.create({ data: { provider: providerName, eventId: eventKey, type: evt.kind } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { received: true, duplicate: true };
      throw e;
    }
    const outcome = await this.applyEvent(providerName, evt);
    await this.prisma.paymentWebhookEvent.update({ where: { provider_eventId: { provider: providerName, eventId: eventKey } }, data: { processedAt: new Date(), outcome } });
    return { received: true, outcome };
  }

  private async nextInvoiceNumber(tx: Prisma.TransactionClient) {
    const [r] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
    return `MYA-${String(r!.n).padStart(6, '0')}`;
  }

  private async applyEvent(providerName: PaymentProvider, evt: BillingEvent): Promise<string> {
    switch (evt.kind) {
      case 'checkout.linked': {
        if (!evt.providerCheckoutRef || !evt.providerSubscriptionId) return 'ignored';
        const r = await this.prisma.billingCheckout.updateMany({ where: { providerRef: evt.providerCheckoutRef, provider: providerName }, data: { providerSubscriptionId: evt.providerSubscriptionId } });
        return r.count ? 'checkout_linked' : 'unknown_checkout';
      }
      case 'subscription.activated':
      case 'subscription.charged':
        return this.activateOrRenew(providerName, evt);
      case 'subscription.payment_failed': {
        const r = await this.prisma.subscription.updateMany({ where: { providerSubscriptionId: evt.providerSubscriptionId ?? '__none__', status: 'active' }, data: { status: 'past_due' } });
        return r.count ? 'past_due' : 'no_change';
      }
      case 'subscription.cancel_scheduled': {
        const r = await this.prisma.subscription.updateMany({ where: { providerSubscriptionId: evt.providerSubscriptionId ?? '__none__' }, data: { cancelAtPeriodEnd: true } });
        return r.count ? 'cancel_scheduled' : 'no_change';
      }
      case 'subscription.halted':
      case 'subscription.ended':
        return this.endSubscription(evt);
      case 'topup.paid':
        return this.completeTopup(providerName, evt);
      default:
        return 'ignored';
    }
  }

  /** Finds which checkout/price a provider subscription belongs to. */
  private async resolveSubscription(providerName: PaymentProvider, evt: BillingEvent) {
    const subId = evt.providerSubscriptionId;
    if (!subId) return null;
    const checkout = await this.prisma.billingCheckout.findFirst({ where: { provider: providerName, kind: 'subscription', OR: [{ providerRef: subId }, { providerSubscriptionId: subId }] } });
    const existing = await this.prisma.subscription.findUnique({ where: { providerSubscriptionId: subId } });
    const priceId = checkout?.planPriceId ?? existing?.priceId ?? null;
    const organizationId = checkout?.organizationId ?? existing?.organizationId ?? null;
    if (!priceId || !organizationId) return null;
    const price = await this.prisma.planPrice.findUniqueOrThrow({ where: { id: priceId }, include: { plan: true } });
    return { checkout, existing, price, organizationId };
  }

  private async activateOrRenew(providerName: PaymentProvider, evt: BillingEvent): Promise<string> {
    const ctx = await this.resolveSubscription(providerName, evt);
    if (!ctx) return 'unknown_subscription';
    const { checkout, price, organizationId } = ctx;
    if (evt.payment && (evt.payment.currency !== price.currency || evt.payment.amountMinor < price.amountMinor)) {
      this.log.error(`subscription ${evt.providerSubscriptionId}: paid ${evt.payment.amountMinor} ${evt.payment.currency}, expected ${price.amountMinor} ${price.currency}`);
      return 'amount_mismatch';
    }
    const now = new Date();
    const periodStart = evt.periodStart ?? now;
    const periodEnd = evt.periodEnd ?? new Date(periodStart.getTime() + (price.interval === 'monthly' ? 30 : 365) * 864e5);
    let replaced: { provider: PaymentProvider; id: string } | null = null;

    await this.prisma.$transaction(async (tx) => {
      const prev = await tx.subscription.findUnique({ where: { organizationId } });
      if (prev?.providerSubscriptionId && prev.providerSubscriptionId !== evt.providerSubscriptionId && prev.provider && ['active', 'past_due'].includes(prev.status)) {
        replaced = { provider: prev.provider, id: prev.providerSubscriptionId };
      }
      const data = {
        planId: price.planId, priceId: price.id, status: 'active' as const, provider: providerName, providerSubscriptionId: evt.providerSubscriptionId,
        providerCustomerId: evt.providerCustomerId ?? prev?.providerCustomerId ?? null, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
        ...(prev?.providerSubscriptionId !== evt.providerSubscriptionId ? { cancelAtPeriodEnd: false, canceledAt: null, endedAt: null } : {}),
      };
      const sub = await tx.subscription.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data } });
      if (evt.payment) {
        await tx.invoice.createMany({
          data: [{
            organizationId, number: await this.nextInvoiceNumber(tx), subscriptionId: sub.id, checkoutId: checkout?.id ?? null,
            description: `${price.plan.name} plan (${price.interval})`, currency: evt.payment.currency, totalMinor: evt.payment.amountMinor,
            taxMinor: evt.payment.taxMinor ?? 0, feeMinor: evt.payment.feeMinor, provider: providerName, providerPaymentId: evt.payment.providerPaymentId,
            periodStart, periodEnd, paidAt: now,
          }],
          skipDuplicates: true,
        });
      }
      if (checkout && checkout.status === 'created') await tx.billingCheckout.update({ where: { id: checkout.id }, data: { status: 'completed', completedAt: now } });
      await this.credits.applyPlan(tx, organizationId, price.plan, 'subscription', periodStart, periodEnd, `sub:${evt.providerSubscriptionId}:${periodStart.toISOString()}`);
    });
    // An upgrade/downgrade replaces the previous paid subscription: stop billing it at the provider.
    const old = replaced as { provider: PaymentProvider; id: string } | null;
    if (old) {
      try {
        await this.providers[old.provider]?.cancelSubscription(old.id, false);
      } catch (e) {
        this.log.error(`failed to cancel replaced subscription ${old.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await this.audit.record({ action: 'billing.subscription_paid', organizationId, targetType: 'subscription', targetId: evt.providerSubscriptionId ?? undefined, metadata: { plan: price.plan.code, event: evt.kind } });
    return evt.kind === 'subscription.charged' ? 'subscription_charged' : 'subscription_activated';
  }

  private async endSubscription(evt: BillingEvent): Promise<string> {
    const sub = await this.prisma.subscription.findUnique({ where: { providerSubscriptionId: evt.providerSubscriptionId ?? '__none__' } });
    if (!sub) return 'unknown_subscription';
    if (['canceled', 'expired', 'halted'].includes(sub.status)) return 'already_ended';
    const status = evt.kind === 'subscription.halted' ? ('halted' as const) : ('canceled' as const);
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub.id }, data: { status, endedAt: new Date(), canceledAt: sub.canceledAt ?? new Date() } });
      await this.credits.revertToFree(tx, sub.organizationId, `${sub.id}:${status}`);
    });
    await this.audit.record({ action: `billing.subscription_${status}`, organizationId: sub.organizationId, targetType: 'subscription', targetId: sub.id });
    return status === 'halted' ? 'subscription_halted' : 'subscription_ended';
  }

  private async completeTopup(providerName: PaymentProvider, evt: BillingEvent): Promise<string> {
    if (!evt.providerCheckoutRef || !evt.payment) return 'ignored';
    const checkout = await this.prisma.billingCheckout.findFirst({ where: { providerRef: evt.providerCheckoutRef, provider: providerName, kind: 'topup' } });
    if (!checkout?.creditPackId) return 'unknown_checkout';
    if (checkout.status === 'completed') return 'already_processed';
    if (evt.payment.amountMinor !== checkout.amountMinor || evt.payment.currency !== checkout.currency) return 'amount_mismatch';
    const pack = await this.prisma.creditPack.findUniqueOrThrow({ where: { id: checkout.creditPackId } });
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.billingCheckout.updateMany({ where: { id: checkout.id, status: 'created' }, data: { status: 'completed', completedAt: new Date() } });
      if (!claimed.count) return;
      await this.credits.grant(checkout.organizationId, pack.credits, 'purchase', `topup:${checkout.id}`, 'purchased', tx, { type: 'billing_checkout', id: checkout.id });
      await tx.invoice.createMany({
        data: [{ organizationId: checkout.organizationId, number: await this.nextInvoiceNumber(tx), checkoutId: checkout.id, description: `Credit top-up: ${pack.name}`, currency: evt.payment!.currency, totalMinor: evt.payment!.amountMinor, taxMinor: evt.payment!.taxMinor ?? 0, feeMinor: evt.payment!.feeMinor, provider: providerName, providerPaymentId: evt.payment!.providerPaymentId, paidAt: new Date() }],
        skipDuplicates: true,
      });
    });
    await this.audit.record({ action: 'billing.topup_paid', organizationId: checkout.organizationId, targetType: 'billing_checkout', targetId: checkout.id, metadata: { credits: pack.credits } });
    return 'topup_credited';
  }
}
