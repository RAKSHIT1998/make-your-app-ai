import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma, type PaygAccount, type PaymentProvider, type PrismaClient } from '@mya/db';
import { GatewayError, type BillingEvent, type BillingProvider } from '@mya/payments';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { CreditsService, paygAmountMinor } from '../credits/credits.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FlagsService } from '../flags/flags.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { BILLING_PROVIDERS, nextInvoiceNumber, providerFor, type BillingProviders } from './billing.shared.js';

export const PAYG_CURRENCIES = ['INR', 'USD'] as const;
export type PaygCurrency = (typeof PAYG_CURRENCIES)[number];

const startOfMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const money = (minor: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
/** A charge we created but never managed to send (process died in between) is released after this long. */
const UNSENT_CHARGE_MS = 10 * 60_000;
/** A failed charge is retried automatically this long after it failed, at most `AUTO_RETRIES` times in a row. */
const RETRY_AFTER_MS = 72 * 3600_000;
const AUTO_RETRIES = 3;

/**
 * Pay-as-you-go: a workspace saves a card, which unlocks Premium AI and lets it keep building after its plan and
 * purchased credits run out, up to a monthly spending cap it sets. Usage past its credits is recorded as owed on the
 * `payg` ledger bucket and charged to the card in batches. The card, its activation and every payment result come only
 * from verified provider webhooks; the customer can only start a setup, set their own cap, switch Premium AI and turn it off.
 */
@Injectable()
export class PaygService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(PaygService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BILLING_PROVIDERS) private readonly providers: BillingProviders,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.NODE_ENV === 'test' || (!this.providers.razorpay && !this.providers.stripe)) return;
    this.timer = setInterval(() => void this.runBilling().catch((e) => this.log.error(`pay-as-you-go billing failed: ${e instanceof Error ? e.message : e}`)), 15 * 60_000);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  limits(currency: string) {
    const c = this.config;
    return currency === 'INR'
      ? { minCapMinor: 10_000, maxCapMinor: c.PAYG_MAX_CAP_INR_MINOR, chargeAtMinor: c.PAYG_CHARGE_AT_INR_MINOR, minChargeMinor: c.PAYG_MIN_CHARGE_INR_MINOR }
      : { minCapMinor: 100, maxCapMinor: c.PAYG_MAX_CAP_USD_MINOR, chargeAtMinor: c.PAYG_CHARGE_AT_USD_MINOR, minChargeMinor: c.PAYG_MIN_CHARGE_USD_MINOR };
  }

  private provider(name: PaymentProvider): BillingProvider {
    const p = this.providers[name];
    if (!p) throw new HttpException({ message: `Card payments via ${name} are not configured on this server yet.`, setupRequired: true }, HttpStatus.SERVICE_UNAVAILABLE);
    return p;
  }

  private gatewayFailure(e: unknown) {
    if (e instanceof HttpException) return e;
    const msg = e instanceof GatewayError ? e.message : 'payment provider error';
    this.log.warn(`pay-as-you-go gateway failure: ${msg}`);
    return new HttpException({ message: `Could not reach the payment provider: ${msg}` }, HttpStatus.BAD_GATEWAY);
  }

  // ───────── Customer view and settings ─────────

  async view(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'viewer');
    const [acct, state, charges, enabled] = await Promise.all([
      this.prisma.paygAccount.findUnique({ where: { organizationId: orgId } }),
      this.credits.paygState(orgId),
      this.prisma.paygCharge.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.flags.isEnabled('pay_as_you_go'),
    ]);
    const currencies = await Promise.all(PAYG_CURRENCIES.map(async (cur) => {
      const rate = await this.credits.paygRate(cur);
      const l = this.limits(cur);
      return { currency: cur, provider: providerFor(cur), available: !!this.providers[providerFor(cur)] && !!rate, rate, minCapMinor: l.minCapMinor, maxCapMinor: l.maxCapMinor };
    }));
    const owedMinor = state.rate ? paygAmountMinor(state.owed, state.rate) : 0;
    return {
      enabled,
      status: state.status,
      active: state.active,
      currency: state.currency,
      provider: acct?.provider ?? null,
      cardLabel: acct?.cardLabel ?? null,
      cardSaved: !!acct?.providerToken,
      monthlyCapMinor: state.monthlyCapMinor,
      capCredits: state.capCredits,
      usedThisMonth: state.usedThisMonth,
      headroom: state.headroom,
      owedCredits: state.owed,
      owedMinor,
      rate: state.rate,
      premiumAi: acct?.premiumAi ?? false,
      premiumAvailable: state.active,
      lastError: acct?.lastError ?? null,
      chargesAt: state.currency ? this.limits(state.currency).chargeAtMinor : null,
      currencies,
      charges: charges.map((c) => ({ id: c.id, status: c.status, amountMinor: c.amountMinor, currency: c.currency, credits: c.credits, error: c.error, createdAt: c.createdAt.toISOString(), settledAt: c.settledAt?.toISOString() ?? null })),
    };
  }

  private assertCap(currency: string, capMinor: number) {
    const l = this.limits(currency);
    if (!Number.isInteger(capMinor) || capMinor < l.minCapMinor || capMinor > l.maxCapMinor) {
      throw new BadRequestException(`The monthly cap must be between ${money(l.minCapMinor, currency)} and ${money(l.maxCapMinor, currency)}.`);
    }
  }

  /** Starts saving a card. Nothing unlocks until the provider's verified webhook confirms the card. */
  async startSetup(user: AuthUser, input: { currency: PaygCurrency; monthlyCapMinor: number; organizationId?: string }) {
    const orgId = input.organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'owner');
    await this.flags.assert('pay_as_you_go', 'Pay-as-you-go');
    this.assertCap(input.currency, input.monthlyCapMinor);
    const rate = await this.credits.paygRate(input.currency);
    if (!rate) throw new HttpException({ message: `Pay-as-you-go in ${input.currency} isn't priced yet: the owner needs an active credit pack in ${input.currency}.`, setupRequired: true }, HttpStatus.SERVICE_UNAVAILABLE);
    const existing = await this.prisma.paygAccount.findUnique({ where: { organizationId: orgId } });
    if (existing?.providerToken && existing.currency !== input.currency && (await this.credits.paygState(orgId)).owed > 0) {
      throw new ConflictException('Pay the outstanding pay-as-you-go usage before switching currency.');
    }
    const providerName = providerFor(input.currency);
    const provider = this.provider(providerName);
    const setupId = crypto.randomUUID();
    const base = this.config.WEB_APP_URL.replace(/\/$/, '');
    let result;
    try {
      result = await provider.createCardSetup({
        setupId, organizationId: orgId, email: user.email, name: user.email.split('@')[0] ?? '', currency: input.currency,
        // A card mandate's per-debit maximum: no single charge is ever above the monthly cap.
        maxDebitMinor: input.monthlyCapMinor,
        successUrl: `${base}/billing?payg=saved`, cancelUrl: `${base}/billing?payg=cancelled`,
      });
    } catch (e) {
      throw this.gatewayFailure(e);
    }
    // A card that is already active keeps working until the new one is confirmed.
    const keep = existing?.providerToken && existing.currency === input.currency && existing.status !== 'pending';
    await this.prisma.paygAccount.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, provider: providerName, currency: input.currency, monthlyCapMinor: input.monthlyCapMinor, providerCustomerId: result.providerCustomerId, setupRef: result.setupRef, createdById: user.id },
      update: {
        setupRef: result.setupRef, providerCustomerId: keep ? existing!.providerCustomerId : result.providerCustomerId, monthlyCapMinor: input.monthlyCapMinor, lastError: null,
        ...(keep ? {} : { provider: providerName, currency: input.currency, status: 'pending' as const, providerToken: null, cardLabel: null, premiumAi: false }),
      },
    });
    await this.audit.record({ action: 'billing.payg_setup_started', actorId: user.id, organizationId: orgId, targetType: 'payg_account', targetId: orgId, metadata: { currency: input.currency, monthlyCapMinor: input.monthlyCapMinor } });
    return result.clientParams;
  }

  async update(user: AuthUser, input: { monthlyCapMinor?: number; premiumAi?: boolean; organizationId?: string }) {
    const orgId = input.organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'owner');
    const acct = await this.prisma.paygAccount.findUnique({ where: { organizationId: orgId } });
    if (!acct) throw new BadRequestException('Add a card for pay-as-you-go first.');
    if (input.monthlyCapMinor !== undefined) this.assertCap(acct.currency, input.monthlyCapMinor);
    if (input.premiumAi && acct.status !== 'active') throw new BadRequestException('Premium AI needs an active pay-as-you-go card.');
    await this.prisma.paygAccount.update({ where: { organizationId: orgId }, data: { ...(input.monthlyCapMinor !== undefined ? { monthlyCapMinor: input.monthlyCapMinor } : {}), ...(input.premiumAi !== undefined ? { premiumAi: input.premiumAi } : {}) } });
    await this.audit.record({ action: 'billing.payg_updated', actorId: user.id, organizationId: orgId, targetType: 'payg_account', targetId: orgId, metadata: input });
    return this.view(user, orgId);
  }

  /** Stops new pay-as-you-go usage. Usage already made is still charged to the saved card. */
  async disable(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'owner');
    const acct = await this.prisma.paygAccount.findUnique({ where: { organizationId: orgId } });
    if (!acct) throw new BadRequestException('Pay-as-you-go is not set up.');
    await this.prisma.paygAccount.update({ where: { organizationId: orgId }, data: { status: 'disabled', premiumAi: false } });
    await this.audit.record({ action: 'billing.payg_disabled', actorId: user.id, organizationId: orgId, targetType: 'payg_account', targetId: orgId });
    return this.view(user, orgId);
  }

  /** Turns pay-as-you-go back on with the card already saved (only if the last payment went through). */
  async enable(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'owner');
    await this.flags.assert('pay_as_you_go', 'Pay-as-you-go');
    const acct = await this.prisma.paygAccount.findUnique({ where: { organizationId: orgId } });
    if (!acct?.providerToken || acct.status !== 'disabled') throw new BadRequestException('Add a card first.');
    const failed = await this.prisma.paygCharge.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
    await this.prisma.paygAccount.update({ where: { organizationId: orgId }, data: { status: failed?.status === 'failed' ? 'past_due' : 'active' } });
    return this.view(user, orgId);
  }

  /** "Pay now" for a past-due workspace (or anyone with unpaid usage): one charge of everything owed. */
  async payNow(user: AuthUser, organizationId?: string) {
    const orgId = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, orgId, 'owner');
    const acct = await this.prisma.paygAccount.findUnique({ where: { organizationId: orgId } });
    if (!acct?.providerToken) throw new BadRequestException('There is no saved card to charge.');
    const r = await this.chargeOwed(acct, { force: true });
    if (r === 'nothing_owed') throw new BadRequestException('There is nothing to pay.');
    if (r === 'already_pending') throw new ConflictException('A payment is already on its way. Card debits in India can take up to two days to complete.');
    return this.view(user, orgId);
  }

  // ───────── Charging ─────────

  /** One pass over saved cards: charges unpaid usage that reached the threshold, or is from an earlier month. */
  async runBilling(now = new Date()) {
    await this.prisma.paygCharge.updateMany({ where: { status: 'pending', providerRef: null, createdAt: { lt: new Date(now.getTime() - UNSENT_CHARGE_MS) } }, data: { status: 'failed', error: 'The charge was never sent to the provider (server restart). Nothing was taken.', settledAt: now } });
    const accounts = await this.prisma.paygAccount.findMany({ where: { providerToken: { not: null }, status: { in: ['active', 'disabled', 'past_due'] } } });
    const outcomes: Record<string, string> = {};
    for (const a of accounts) outcomes[a.organizationId] = await this.chargeOwed(a, { now }).catch((e) => `error: ${e instanceof Error ? e.message : e}`);
    return outcomes;
  }

  private async chargeOwed(acct: PaygAccount, opts: { force?: boolean; now?: Date }): Promise<string> {
    const now = opts.now ?? new Date();
    const provider = this.providers[acct.provider];
    if (!provider || !acct.providerToken || !acct.providerCustomerId) return 'no_provider';
    const rate = await this.credits.paygRate(acct.currency);
    if (!rate) return 'no_rate';
    const state = await this.credits.paygState(acct.organizationId);
    if (state.owed <= 0) return 'nothing_owed';
    const amountMinor = paygAmountMinor(state.owed, rate);
    const l = this.limits(acct.currency);
    const last = await this.prisma.paygCharge.findFirst({ where: { organizationId: acct.organizationId }, orderBy: { createdAt: 'desc' } });
    if (last?.status === 'pending') return 'already_pending';
    if (!opts.force) {
      if (acct.status === 'past_due') {
        const fails = await this.prisma.paygCharge.findMany({ where: { organizationId: acct.organizationId }, orderBy: { createdAt: 'desc' }, take: AUTO_RETRIES, select: { status: true } });
        if (fails.length >= AUTO_RETRIES && fails.every((f) => f.status === 'failed')) return 'waiting_for_customer';
        if (last && now.getTime() - (last.settledAt ?? last.createdAt).getTime() < RETRY_AFTER_MS) return 'retry_later';
      } else {
        const monthStart = startOfMonthUtc(now);
        const since = last?.createdAt ?? new Date(0);
        const oldUsage = await this.prisma.creditLedgerEntry.count({ where: { organizationId: acct.organizationId, bucket: 'payg', reason: 'ai_usage', createdAt: { gt: since, lt: monthStart } } });
        const due = amountMinor >= l.chargeAtMinor || (oldUsage > 0 && amountMinor >= l.minChargeMinor);
        if (!due) return 'not_due';
      }
    }
    if (amountMinor < Math.min(l.minChargeMinor, 50)) return 'below_minimum';
    let charge;
    try {
      charge = await this.prisma.paygCharge.create({ data: { organizationId: acct.organizationId, provider: acct.provider, currency: acct.currency, amountMinor, credits: state.owed } });
    } catch (e) {
      // The partial unique index allows one unsettled charge per workspace, across every API instance.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'already_pending';
      throw e;
    }
    const owner = await this.prisma.user.findUnique({ where: { id: acct.createdById }, select: { email: true } });
    try {
      const r = await provider.chargeSavedCard({ chargeId: charge.id, amountMinor, currency: acct.currency, customerId: acct.providerCustomerId, token: acct.providerToken, email: owner?.email ?? '', description: `Make Your App AI pay-as-you-go: ${state.owed} credits` });
      await this.prisma.paygCharge.update({ where: { id: charge.id }, data: { providerRef: r.providerRef } });
    } catch (e) {
      // The provider refused the charge outright (for example a declined card). Restricting is safe on our own call;
      // a payment is only ever marked paid from its verified webhook.
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.$transaction([
        this.prisma.paygCharge.update({ where: { id: charge.id }, data: { status: 'failed', error: msg.slice(0, 500), settledAt: new Date() } }),
        this.prisma.paygAccount.update({ where: { organizationId: acct.organizationId }, data: { status: acct.status === 'disabled' ? 'disabled' : 'past_due', premiumAi: false, lastError: msg.slice(0, 500) } }),
      ]);
      await this.audit.record({ action: 'billing.payg_charge_failed', organizationId: acct.organizationId, targetType: 'payg_charge', targetId: charge.id, metadata: { amountMinor, currency: acct.currency } });
      return 'charge_failed';
    }
    await this.audit.record({ action: 'billing.payg_charge_started', organizationId: acct.organizationId, targetType: 'payg_charge', targetId: charge.id, metadata: { amountMinor, currency: acct.currency, credits: state.owed } });
    return 'charge_started';
  }

  // ───────── Verified webhooks ─────────

  /** Applies pay-as-you-go events. Returns null when the event isn't ours, so normal billing handles it. */
  async applyEvent(providerName: PaymentProvider, evt: BillingEvent): Promise<string | null> {
    switch (evt.kind) {
      case 'card_setup.completed':
        return this.setupCompleted(providerName, evt);
      case 'card_token.confirmed':
      case 'card_token.rejected':
        return this.tokenResult(providerName, evt);
      case 'payment.succeeded':
      case 'topup.paid':
      case 'payment.failed':
        return this.paymentResult(providerName, evt);
      default:
        return null;
    }
  }

  private async setupCompleted(providerName: PaymentProvider, evt: BillingEvent): Promise<string> {
    const acct = evt.providerCheckoutRef ? await this.prisma.paygAccount.findUnique({ where: { setupRef: evt.providerCheckoutRef } }) : null;
    if (!acct || acct.provider !== providerName) return 'unknown_card_setup';
    const setupIntentId = evt.card?.setupIntentId;
    if (!setupIntentId) return 'ignored';
    let saved;
    try {
      saved = await this.providers[providerName]?.resolveCardSetup?.(setupIntentId);
    } catch (e) {
      this.log.error(`could not read setup ${setupIntentId}: ${e instanceof Error ? e.message : e}`);
      throw e; // let the provider retry the webhook
    }
    if (!saved) return 'card_not_saved';
    await this.activate(acct, saved.token, saved.cardLabel, evt.providerCustomerId);
    return 'payg_activated';
  }

  /** Razorpay: the bank confirmed (or rejected) the card mandate created by the ₹1 authorisation. */
  private async tokenResult(providerName: PaymentProvider, evt: BillingEvent): Promise<string> {
    const tokenId = evt.card?.tokenId;
    if (!tokenId || !evt.providerCustomerId) return 'ignored';
    const acct = await this.prisma.paygAccount.findFirst({ where: { provider: providerName, providerCustomerId: evt.providerCustomerId } });
    if (!acct) return 'unknown_card_setup';
    if (evt.kind === 'card_token.rejected') {
      if (acct.providerToken && acct.providerToken !== tokenId) return 'ignored'; // an older card stays in use
      await this.prisma.paygAccount.update({ where: { organizationId: acct.organizationId }, data: { status: 'pending', providerToken: null, premiumAi: false, lastError: "Your bank didn't approve the card for automatic payments. Try another card." } });
      return 'card_rejected';
    }
    await this.activate(acct, tokenId, evt.card?.cardLabel ?? null, null);
    return 'payg_activated';
  }

  private async activate(acct: PaygAccount, token: string, label: string | null, customerId: string | null) {
    const pastDue = acct.status === 'past_due';
    await this.prisma.paygAccount.update({
      where: { organizationId: acct.organizationId },
      data: { providerToken: token, cardLabel: label ?? acct.cardLabel, ...(customerId ? { providerCustomerId: customerId } : {}), status: pastDue ? 'past_due' : 'active', activatedAt: acct.activatedAt ?? new Date(), lastError: null },
    });
    await this.audit.record({ action: 'billing.payg_card_saved', organizationId: acct.organizationId, targetType: 'payg_account', targetId: acct.organizationId, metadata: { provider: acct.provider } });
    // A new card for a past-due workspace settles what's owed straight away.
    if (pastDue) await this.chargeOwed({ ...acct, providerToken: token, ...(customerId ? { providerCustomerId: customerId } : {}) }, { force: true }).catch(() => {});
  }

  private async paymentResult(providerName: PaymentProvider, evt: BillingEvent): Promise<string | null> {
    if (!evt.providerCheckoutRef) return null;
    // Razorpay's ₹1 card-mandate payment: remember the token; activation waits for `token.confirmed`.
    const setup = await this.prisma.paygAccount.findUnique({ where: { setupRef: evt.providerCheckoutRef } });
    if (setup) {
      if (evt.kind === 'payment.failed') {
        await this.prisma.paygAccount.updateMany({ where: { organizationId: setup.organizationId, status: 'pending' }, data: { lastError: evt.failureReason ?? 'The card check failed.' } });
        return 'card_check_failed';
      }
      if (evt.card?.cardLabel && !setup.cardLabel) await this.prisma.paygAccount.update({ where: { organizationId: setup.organizationId }, data: { cardLabel: evt.card.cardLabel } });
      return 'card_check_paid';
    }
    const charge = await this.prisma.paygCharge.findUnique({ where: { providerRef: evt.providerCheckoutRef } });
    if (!charge || charge.provider !== providerName) return null;
    if (evt.kind === 'payment.failed') {
      const r = await this.prisma.paygCharge.updateMany({ where: { id: charge.id, status: 'pending' }, data: { status: 'failed', error: (evt.failureReason ?? 'The payment failed.').slice(0, 500), settledAt: new Date() } });
      if (!r.count) return 'already_settled';
      await this.prisma.paygAccount.updateMany({ where: { organizationId: charge.organizationId, status: 'active' }, data: { status: 'past_due', premiumAi: false } });
      await this.prisma.paygAccount.update({ where: { organizationId: charge.organizationId }, data: { lastError: (evt.failureReason ?? 'The payment failed.').slice(0, 500) } });
      await this.audit.record({ action: 'billing.payg_charge_failed', organizationId: charge.organizationId, targetType: 'payg_charge', targetId: charge.id });
      return 'payg_charge_failed';
    }
    const pay = evt.payment;
    if (!pay) return 'ignored';
    if (pay.currency !== charge.currency || pay.amountMinor < charge.amountMinor) {
      this.log.error(`payg charge ${charge.id}: paid ${pay.amountMinor} ${pay.currency}, expected ${charge.amountMinor} ${charge.currency}`);
      return 'amount_mismatch';
    }
    let settled = false;
    await this.prisma.$transaction(async (tx) => {
      // A charge that "failed" can still succeed on a provider retry: money received is always recorded.
      const claimed = await tx.paygCharge.updateMany({ where: { id: charge.id, status: { in: ['pending', 'failed'] } }, data: { status: 'paid', providerPaymentId: pay.providerPaymentId, settledAt: new Date(), error: null } });
      if (!claimed.count) return;
      settled = true;
      await this.credits.grant(charge.organizationId, charge.credits, 'purchase', `payg-paid:${charge.id}`, 'payg', tx, { type: 'payg_charge', id: charge.id });
      const number = await nextInvoiceNumber(tx);
      await tx.invoice.createMany({
        data: [{ organizationId: charge.organizationId, number, description: `Pay-as-you-go AI usage (${charge.credits} credits)`, currency: pay.currency, totalMinor: pay.amountMinor, taxMinor: pay.taxMinor ?? 0, feeMinor: pay.feeMinor, provider: providerName, providerPaymentId: pay.providerPaymentId, paidAt: new Date() }],
        skipDuplicates: true,
      });
      const inv = await tx.invoice.findUnique({ where: { providerPaymentId: pay.providerPaymentId }, select: { id: true } });
      if (inv) await tx.paygCharge.update({ where: { id: charge.id }, data: { invoiceId: inv.id } });
      await tx.paygAccount.updateMany({ where: { organizationId: charge.organizationId, status: 'past_due' }, data: { status: 'active' } });
      await tx.paygAccount.update({ where: { organizationId: charge.organizationId }, data: { lastError: null } });
    });
    if (!settled) return 'already_settled';
    await this.audit.record({ action: 'billing.payg_charge_paid', organizationId: charge.organizationId, targetType: 'payg_charge', targetId: charge.id, metadata: { amountMinor: pay.amountMinor, currency: pay.currency, credits: charge.credits } });
    return 'payg_charge_paid';
  }
}
