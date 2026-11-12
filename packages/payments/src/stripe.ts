import Stripe from 'stripe';
import { GatewayError, WebhookSignatureError, type CreatePaymentInput, type CreatedPayment, type NormalizedEvent, type PaymentGateway, type RefundResult, type StripeCredentials } from './types.js';

/** Stripe via the official SDK: PaymentIntents, Refunds, signed webhooks (Stripe-Signature). */
export class StripeGateway implements PaymentGateway {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(private readonly creds: StripeCredentials, opts: { fetch?: typeof fetch } = {}) {
    this.stripe = new Stripe(creds.secretKey, {
      maxNetworkRetries: 2,
      ...(opts.fetch ? { httpClient: Stripe.createFetchHttpClient(opts.fetch) } : {}),
    });
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    try {
      const pi = await this.stripe.paymentIntents.create(
        { amount: input.amountMinor, currency: input.currency.toLowerCase(), automatic_payment_methods: { enabled: true }, metadata: { order_id: input.orderId, receipt: input.receipt } },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!pi.client_secret) throw new GatewayError('Stripe did not return a client secret');
      return { providerOrderId: pi.id, clientParams: { provider: 'stripe', publishableKey: this.creds.publishableKey, clientSecret: pi.client_secret } };
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw new GatewayError(`Stripe: ${e instanceof Error ? e.message : String(e)}`, (e as { statusCode?: number }).statusCode);
    }
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const sig = headers['stripe-signature'];
    if (typeof sig !== 'string') throw new WebhookSignatureError('Missing Stripe-Signature');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.creds.webhookSecret);
    } catch {
      throw new WebhookSignatureError();
    }
    const base = { eventId: event.id, raw: event };
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const latestCharge = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? null);
      return {
        ...base,
        type: event.type === 'payment_intent.succeeded' ? 'payment.succeeded' : 'payment.failed',
        providerOrderId: pi.id,
        providerPaymentId: latestCharge ?? pi.id,
        amountMinor: event.type === 'payment_intent.succeeded' ? pi.amount_received : pi.amount,
        currency: pi.currency.toUpperCase(),
      };
    }
    return { ...base, type: 'ignored', providerOrderId: null, providerPaymentId: null, amountMinor: null, currency: null };
  }

  async refund(input: { providerPaymentId: string; amountMinor: number; idempotencyKey: string }): Promise<RefundResult> {
    // providerPaymentId is the PaymentIntent id (pi_...) or a Charge id (ch_...).
    const target = input.providerPaymentId.startsWith('pi_') ? { payment_intent: input.providerPaymentId } : { charge: input.providerPaymentId };
    try {
      const r = await this.stripe.refunds.create({ ...target, amount: input.amountMinor }, { idempotencyKey: input.idempotencyKey });
      return { providerRefundId: r.id, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending' };
    } catch (e) {
      throw new GatewayError(`Stripe: ${e instanceof Error ? e.message : String(e)}`, (e as { statusCode?: number }).statusCode);
    }
  }

  async testConnection() {
    try {
      await this.stripe.balance.retrieve();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
