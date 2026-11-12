import { createHmac, timingSafeEqual } from 'node:crypto';
import { GatewayError, WebhookSignatureError, type CreatePaymentInput, type CreatedPayment, type NormalizedEvent, type PaymentGateway, type RazorpayCredentials, type RefundResult } from './types.js';

const API = 'https://api.razorpay.com/v1';

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Razorpay via its REST API (Orders, Refunds, Webhooks).
 * - Orders: POST /v1/orders {amount, currency, receipt, notes}
 * - Refunds: POST /v1/payments/:id/refund {amount}
 * - Webhooks: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret), hex
 * - Checkout callback: razorpay_signature = HMAC-SHA256(`${order_id}|${payment_id}`, key secret), hex
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  constructor(private readonly creds: RazorpayCredentials, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call<T>(path: string, init: { method: string; body?: unknown; idempotencyKey?: string }): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.creds.keyId}:${this.creds.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(init.idempotencyKey ? { 'X-Idempotency-Key': init.idempotencyKey } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok) throw new GatewayError(`Razorpay: ${body.error?.description ?? res.statusText}`, res.status);
    return body as T;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const order = await this.call<{ id: string; amount: number; currency: string }>('/orders', {
      method: 'POST',
      body: { amount: input.amountMinor, currency: input.currency, receipt: input.receipt.slice(0, 40), notes: { order_id: input.orderId } },
    });
    return { providerOrderId: order.id, clientParams: { provider: 'razorpay', keyId: this.creds.keyId, razorpayOrderId: order.id, amount: order.amount, currency: order.currency } };
  }

  /** Verifies the signature returned to the browser by Razorpay Checkout after a successful payment. */
  verifyCheckoutSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
    const expected = createHmac('sha256', this.creds.keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
    return safeEqualHex(expected, signature);
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const sig = headers['x-razorpay-signature'];
    if (typeof sig !== 'string') throw new WebhookSignatureError('Missing X-Razorpay-Signature');
    const expected = createHmac('sha256', this.creds.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqualHex(expected, sig)) throw new WebhookSignatureError();
    const evt = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string | null; amount: number; currency: string } }; refund?: { entity?: { id: string; payment_id: string } } };
    };
    const eventIdHeader = headers['x-razorpay-event-id'];
    const p = evt.payload?.payment?.entity;
    const base = {
      eventId: typeof eventIdHeader === 'string' ? eventIdHeader : `${evt.event}:${p?.id ?? evt.payload?.refund?.entity?.id ?? 'unknown'}`,
      providerOrderId: p?.order_id ?? null,
      providerPaymentId: p?.id ?? evt.payload?.refund?.entity?.payment_id ?? null,
      amountMinor: p?.amount ?? null,
      currency: p?.currency ?? null,
      raw: evt,
    };
    switch (evt.event) {
      case 'payment.captured':
      case 'order.paid':
        return { ...base, type: 'payment.succeeded' };
      case 'payment.failed':
        return { ...base, type: 'payment.failed' };
      case 'refund.processed':
        return { ...base, type: 'refund.succeeded' };
      default:
        return { ...base, type: 'ignored' };
    }
  }

  async refund(input: { providerPaymentId: string; amountMinor: number; idempotencyKey: string }): Promise<RefundResult> {
    const r = await this.call<{ id: string; status: string }>(`/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, { method: 'POST', body: { amount: input.amountMinor }, idempotencyKey: input.idempotencyKey });
    return { providerRefundId: r.id, status: r.status === 'processed' ? 'succeeded' : r.status === 'failed' ? 'failed' : 'pending' };
  }

  async testConnection() {
    try {
      await this.call('/orders?count=1', { method: 'GET' });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
