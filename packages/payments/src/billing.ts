import { createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import { GatewayError, WebhookSignatureError } from './types.js';

/**
 * Platform billing: how Make Your App AI charges ITS customers (subscriptions + credit top-ups).
 * Separate from merchant store payments, and uses the platform's own provider accounts.
 */

export type BillingEventKind =
  | 'subscription.activated'
  | 'subscription.charged'
  | 'subscription.payment_failed'
  | 'subscription.halted'
  | 'subscription.cancel_scheduled'
  | 'subscription.ended'
  | 'checkout.linked'
  | 'topup.paid'
  | 'payment.refunded'
  | 'ignored';

export interface BillingPaymentInfo {
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  feeMinor: number | null;
  taxMinor: number | null;
}

export interface BillingEvent {
  eventId: string;
  kind: BillingEventKind;
  providerSubscriptionId: string | null;
  /** Our checkout reference at the provider: Razorpay subscription/order id, or Stripe Checkout Session id. */
  providerCheckoutRef: string | null;
  providerCustomerId: string | null;
  payment: BillingPaymentInfo | null;
  /** Set for `payment.refunded`. `refundedTotalMinor` is cumulative for the payment, so replays and partial refunds are safe. */
  refund: { providerPaymentId: string; refundedTotalMinor: number; currency: string; paymentIntentId?: string | null } | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  raw: unknown;
}

export interface CheckoutResult {
  providerRef: string;
  clientParams: Record<string, string | number>;
}

export interface BillingProvider {
  readonly name: 'razorpay' | 'stripe';
  /** Returns the provider plan/price reference for a PlanPrice, creating it where the provider allows. */
  ensurePlan(p: { planName: string; interval: 'monthly' | 'yearly'; amountMinor: number; currency: string; existingRef: string | null }): Promise<string>;
  createSubscriptionCheckout(p: { providerPlanRef: string; interval: 'monthly' | 'yearly'; checkoutId: string; organizationId: string; email: string; successUrl: string; cancelUrl: string }): Promise<CheckoutResult>;
  createTopupCheckout(p: { amountMinor: number; currency: string; description: string; checkoutId: string; organizationId: string; email: string; successUrl: string; cancelUrl: string }): Promise<CheckoutResult>;
  cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): BillingEvent;
  /** Maps a payment reference in a refund event to the reference stored on our invoice, when the provider needs a lookup. */
  resolveInvoicePaymentId?(paymentIntentId: string): Promise<string | null>;
}

const sec = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? new Date(n * 1000) : null);

// ───────────────────────── Razorpay (Subscriptions + Orders APIs) ─────────────────────────

export interface RazorpayBillingCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export class RazorpayBilling implements BillingProvider {
  readonly name = 'razorpay' as const;
  constructor(private readonly c: RazorpayBillingCredentials, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${this.c.keyId}:${this.c.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok) throw new GatewayError(`Razorpay: ${json.error?.description ?? res.statusText}`, res.status);
    return json as T;
  }

  async ensurePlan(p: { planName: string; interval: 'monthly' | 'yearly'; amountMinor: number; currency: string; existingRef: string | null }) {
    if (p.existingRef) return p.existingRef;
    const plan = await this.call<{ id: string }>('/plans', 'POST', {
      period: p.interval,
      interval: 1,
      item: { name: p.planName, amount: p.amountMinor, currency: p.currency },
    });
    return plan.id;
  }

  async createSubscriptionCheckout(p: { providerPlanRef: string; interval: 'monthly' | 'yearly'; checkoutId: string; organizationId: string; email: string }) {
    // total_count is required by Razorpay: bill for up to 10 years; customers cancel any time.
    const sub = await this.call<{ id: string; short_url?: string }>('/subscriptions', 'POST', {
      plan_id: p.providerPlanRef,
      total_count: p.interval === 'monthly' ? 120 : 10,
      customer_notify: 1,
      notes: { checkout_id: p.checkoutId, organization_id: p.organizationId },
    });
    return { providerRef: sub.id, clientParams: { provider: 'razorpay', keyId: this.c.keyId, subscriptionId: sub.id, email: p.email, ...(sub.short_url ? { shortUrl: sub.short_url } : {}) } };
  }

  async createTopupCheckout(p: { amountMinor: number; currency: string; description: string; checkoutId: string; organizationId: string; email: string }) {
    const order = await this.call<{ id: string; amount: number; currency: string }>('/orders', 'POST', {
      amount: p.amountMinor,
      currency: p.currency,
      receipt: p.checkoutId.slice(0, 40),
      notes: { checkout_id: p.checkoutId, organization_id: p.organizationId, kind: 'topup' },
    });
    return { providerRef: order.id, clientParams: { provider: 'razorpay', keyId: this.c.keyId, orderId: order.id, amount: order.amount, currency: order.currency, description: p.description, email: p.email } };
  }

  async cancelSubscription(id: string, atPeriodEnd: boolean) {
    await this.call(`/subscriptions/${encodeURIComponent(id)}/cancel`, 'POST', { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 });
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): BillingEvent {
    const sig = headers['x-razorpay-signature'];
    if (typeof sig !== 'string') throw new WebhookSignatureError('Missing X-Razorpay-Signature');
    const expected = Buffer.from(createHmac('sha256', this.c.webhookSecret).update(rawBody).digest('hex'));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new WebhookSignatureError();
    type Sub = { id: string; status: string; current_start?: number | null; current_end?: number | null; customer_id?: string | null };
    type Pay = { id: string; amount: number; currency: string; fee?: number | null; tax?: number | null; order_id?: string | null; amount_refunded?: number | null };
    type Ref = { id: string; payment_id: string; amount: number; currency?: string };
    const evt = JSON.parse(rawBody.toString('utf8')) as { event: string; payload?: { subscription?: { entity?: Sub }; payment?: { entity?: Pay }; order?: { entity?: { id: string } }; refund?: { entity?: Ref } } };
    const sub = evt.payload?.subscription?.entity;
    const pay = evt.payload?.payment?.entity;
    const idHeader = headers['x-razorpay-event-id'];
    const base: BillingEvent = {
      eventId: typeof idHeader === 'string' ? idHeader : `${evt.event}:${sub?.id ?? ''}:${pay?.id ?? ''}`,
      kind: 'ignored',
      providerSubscriptionId: sub?.id ?? null,
      providerCheckoutRef: sub?.id ?? evt.payload?.order?.entity?.id ?? pay?.order_id ?? null,
      providerCustomerId: sub?.customer_id ?? null,
      payment: pay ? { providerPaymentId: pay.id, amountMinor: pay.amount, currency: pay.currency.toUpperCase(), feeMinor: pay.fee ?? null, taxMinor: pay.tax ?? null } : null,
      refund: null,
      periodStart: sec(sub?.current_start),
      periodEnd: sec(sub?.current_end),
      raw: evt,
    };
    switch (evt.event) {
      case 'subscription.activated':
        return { ...base, kind: 'subscription.activated', payment: null };
      case 'subscription.charged':
        return { ...base, kind: 'subscription.charged' };
      case 'subscription.pending':
        return { ...base, kind: 'subscription.payment_failed' };
      case 'subscription.halted':
        return { ...base, kind: 'subscription.halted' };
      case 'subscription.cancelled':
      case 'subscription.completed':
        return { ...base, kind: 'subscription.ended' };
      case 'order.paid':
        return sub ? base : { ...base, kind: 'topup.paid' };
      case 'refund.processed': {
        const ref = evt.payload?.refund?.entity;
        if (!ref?.payment_id) return base;
        // Prefer the payment's cumulative refunded amount; fall back to this refund's amount.
        const total = pay?.amount_refunded ?? ref.amount;
        return { ...base, kind: 'payment.refunded', payment: null, refund: { providerPaymentId: ref.payment_id, refundedTotalMinor: total, currency: (ref.currency ?? pay?.currency ?? '').toUpperCase() } };
      }
      default:
        return base;
    }
  }
}

// ───────────────────────── Stripe (Checkout Sessions + Billing) ─────────────────────────

export interface StripeBillingCredentials {
  secretKey: string;
  webhookSecret: string;
}

export class StripeBilling implements BillingProvider {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(private readonly c: StripeBillingCredentials, opts: { fetch?: typeof fetch } = {}) {
    this.stripe = new Stripe(c.secretKey, { maxNetworkRetries: 2, ...(opts.fetch ? { httpClient: Stripe.createFetchHttpClient(opts.fetch) } : {}) });
  }

  async ensurePlan(p: { existingRef: string | null; planName: string }) {
    if (!p.existingRef) throw new GatewayError(`Stripe price not configured for "${p.planName}". Create a recurring Price in Stripe and save its id on the plan price.`);
    return p.existingRef;
  }

  private wrap<T>(fn: () => Promise<T>) {
    return fn().catch((e: unknown) => {
      throw new GatewayError(`Stripe: ${e instanceof Error ? e.message : String(e)}`, (e as { statusCode?: number }).statusCode);
    });
  }

  async createSubscriptionCheckout(p: { providerPlanRef: string; checkoutId: string; organizationId: string; email: string; successUrl: string; cancelUrl: string }) {
    const session = await this.wrap(() =>
      this.stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          line_items: [{ price: p.providerPlanRef, quantity: 1 }],
          client_reference_id: p.checkoutId,
          customer_email: p.email,
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          metadata: { checkout_id: p.checkoutId, organization_id: p.organizationId },
          subscription_data: { metadata: { checkout_id: p.checkoutId, organization_id: p.organizationId } },
        },
        { idempotencyKey: `sub-checkout:${p.checkoutId}` },
      ),
    );
    if (!session.url) throw new GatewayError('Stripe did not return a checkout URL');
    return { providerRef: session.id, clientParams: { provider: 'stripe', checkoutUrl: session.url } };
  }

  async createTopupCheckout(p: { amountMinor: number; currency: string; description: string; checkoutId: string; organizationId: string; email: string; successUrl: string; cancelUrl: string }) {
    const session = await this.wrap(() =>
      this.stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [{ quantity: 1, price_data: { currency: p.currency.toLowerCase(), unit_amount: p.amountMinor, product_data: { name: p.description } } }],
          client_reference_id: p.checkoutId,
          customer_email: p.email,
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          metadata: { checkout_id: p.checkoutId, organization_id: p.organizationId, kind: 'topup' },
        },
        { idempotencyKey: `topup-checkout:${p.checkoutId}` },
      ),
    );
    if (!session.url) throw new GatewayError('Stripe did not return a checkout URL');
    return { providerRef: session.id, clientParams: { provider: 'stripe', checkoutUrl: session.url } };
  }

  /** Subscription invoices are stored under the Stripe invoice id; refunds arrive keyed by payment intent. */
  async resolveInvoicePaymentId(paymentIntentId: string) {
    const r = await this.wrap(() => this.stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 1 }));
    const inv = r.data[0]?.invoice;
    return typeof inv === 'string' ? inv : (inv?.id ?? null);
  }

  async cancelSubscription(id: string, atPeriodEnd: boolean) {
    await this.wrap(() => (atPeriodEnd ? this.stripe.subscriptions.update(id, { cancel_at_period_end: true }) : this.stripe.subscriptions.cancel(id)));
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): BillingEvent {
    const sig = headers['stripe-signature'];
    if (typeof sig !== 'string') throw new WebhookSignatureError('Missing Stripe-Signature');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.c.webhookSecret);
    } catch {
      throw new WebhookSignatureError();
    }
    const base: BillingEvent = { eventId: event.id, kind: 'ignored', providerSubscriptionId: null, providerCheckoutRef: null, providerCustomerId: null, payment: null, refund: null, periodStart: null, periodEnd: null, raw: event };
    const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : (v?.id ?? null));

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode === 'subscription') return { ...base, kind: 'checkout.linked', providerCheckoutRef: s.id, providerSubscriptionId: idOf(s.subscription), providerCustomerId: idOf(s.customer) };
        if (s.mode === 'payment' && s.payment_status === 'paid') {
          return { ...base, kind: 'topup.paid', providerCheckoutRef: s.id, providerCustomerId: idOf(s.customer), payment: { providerPaymentId: idOf(s.payment_intent) ?? s.id, amountMinor: s.amount_total ?? 0, currency: (s.currency ?? '').toUpperCase(), feeMinor: null, taxMinor: s.total_details?.amount_tax ?? null } };
        }
        return base;
      }
      case 'invoice.paid': {
        const inv = event.data.object;
        const subId = idOf(inv.parent?.subscription_details?.subscription);
        if (!subId) return base;
        const period = inv.lines.data[0]?.period;
        return {
          ...base,
          kind: 'subscription.charged',
          providerSubscriptionId: subId,
          providerCustomerId: idOf(inv.customer),
          payment: { providerPaymentId: inv.id ?? event.id, amountMinor: inv.amount_paid, currency: inv.currency.toUpperCase(), feeMinor: null, taxMinor: null },
          periodStart: sec(period?.start),
          periodEnd: sec(period?.end),
        };
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        return { ...base, kind: 'subscription.payment_failed', providerSubscriptionId: idOf(inv.parent?.subscription_details?.subscription) };
      }
      case 'customer.subscription.updated': {
        const s = event.data.object;
        return s.cancel_at_period_end ? { ...base, kind: 'subscription.cancel_scheduled', providerSubscriptionId: s.id } : base;
      }
      case 'customer.subscription.deleted':
        return { ...base, kind: 'subscription.ended', providerSubscriptionId: event.data.object.id };
      case 'charge.refunded': {
        const ch = event.data.object;
        const pi = idOf(ch.payment_intent);
        if (!pi) return base;
        return { ...base, kind: 'payment.refunded', refund: { providerPaymentId: pi, paymentIntentId: pi, refundedTotalMinor: ch.amount_refunded, currency: ch.currency.toUpperCase() } };
      }
      default:
        return base;
    }
  }
}
