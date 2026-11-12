export type PaymentProviderName = 'razorpay' | 'stripe';

export interface CreatePaymentInput {
  amountMinor: number;
  currency: string; // ISO 4217, upper case
  orderId: string; // our order id
  receipt: string; // human-readable order reference
  idempotencyKey: string;
}

/** What the storefront needs to complete payment client-side. Never contains secrets. */
export interface CreatedPayment {
  providerOrderId: string;
  clientParams: Record<string, string | number>;
}

export type NormalizedEventType = 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'ignored';

export interface NormalizedEvent {
  eventId: string;
  type: NormalizedEventType;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  raw: unknown;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'succeeded' | 'pending' | 'failed';
}

export interface PaymentGateway {
  readonly name: PaymentProviderName;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /** Verifies the signature over the exact raw body. Throws WebhookSignatureError when invalid. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent;
  refund(input: { providerPaymentId: string; amountMinor: number; idempotencyKey: string }): Promise<RefundResult>;
  /** Makes a harmless authenticated call to prove the credentials work. */
  testConnection(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export class WebhookSignatureError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export class GatewayError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface RazorpayCredentials { keyId: string; keySecret: string; webhookSecret: string }
export interface StripeCredentials { secretKey: string; publishableKey: string; webhookSecret: string }
export type GatewayCredentials = ({ provider: 'razorpay' } & RazorpayCredentials) | ({ provider: 'stripe' } & StripeCredentials);
