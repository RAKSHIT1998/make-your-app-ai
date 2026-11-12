import { RazorpayGateway } from './razorpay.js';
import { StripeGateway } from './stripe.js';
import type { GatewayCredentials, PaymentGateway } from './types.js';

export * from './types.js';
export { RazorpayGateway } from './razorpay.js';
export { StripeGateway } from './stripe.js';

export type GatewayFactory = (creds: GatewayCredentials) => PaymentGateway;

export const defaultGatewayFactory: GatewayFactory = (creds) =>
  creds.provider === 'razorpay'
    ? new RazorpayGateway({ keyId: creds.keyId, keySecret: creds.keySecret, webhookSecret: creds.webhookSecret })
    : new StripeGateway({ secretKey: creds.secretKey, publishableKey: creds.publishableKey, webhookSecret: creds.webhookSecret });
