import type { PaymentProvider, Prisma } from '@mya/db';
import { RazorpayBilling, StripeBilling, type BillingProvider } from '@mya/payments';
import { APP_CONFIG, type AppConfig } from '../config.js';

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
export const providerFor = (currency: string): PaymentProvider => (currency === 'INR' ? 'razorpay' : 'stripe');


/** Platform invoice numbers come from one database sequence. */
export async function nextInvoiceNumber(tx: Prisma.TransactionClient) {
  const [r] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
  return `MYA-${String(r!.n).padStart(6, '0')}`;
}
