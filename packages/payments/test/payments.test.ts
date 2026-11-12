import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { RazorpayGateway, StripeGateway, WebhookSignatureError } from '../src/index.js';

const rzpCreds = { keyId: 'rzp_test_abc', keySecret: 'key_secret_123', webhookSecret: 'whsec_rzp_456' };

describe('RazorpayGateway', () => {
  it('creates orders with basic auth and returns only public client params', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const g = new RazorpayGateway(rzpCreds, (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.init = init;
      return new Response(JSON.stringify({ id: 'order_Rz1', amount: 49900, currency: 'INR', status: 'created' }), { status: 200 });
    }) as typeof fetch);
    const p = await g.createPayment({ amountMinor: 49900, currency: 'INR', orderId: 'o1', receipt: '#1001', idempotencyKey: 'k' });
    expect(seen.url).toBe('https://api.razorpay.com/v1/orders');
    expect((seen.init!.headers as Record<string, string>)['Authorization']).toBe(`Basic ${Buffer.from('rzp_test_abc:key_secret_123').toString('base64')}`);
    expect(JSON.parse(String(seen.init!.body))).toEqual({ amount: 49900, currency: 'INR', receipt: '#1001', notes: { order_id: 'o1' } });
    expect(p).toEqual({ providerOrderId: 'order_Rz1', clientParams: { provider: 'razorpay', keyId: 'rzp_test_abc', razorpayOrderId: 'order_Rz1', amount: 49900, currency: 'INR' } });
    expect(JSON.stringify(p)).not.toContain('key_secret');
  });

  it('verifies webhook signatures over the raw body and rejects tampering', () => {
    const g = new RazorpayGateway(rzpCreds);
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_Rz1', amount: 49900, currency: 'INR' } } } }));
    const sig = createHmac('sha256', rzpCreds.webhookSecret).update(body).digest('hex');
    expect(g.verifyWebhook(body, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' })).toMatchObject({ eventId: 'evt_1', type: 'payment.succeeded', providerOrderId: 'order_Rz1', providerPaymentId: 'pay_1', amountMinor: 49900 });
    const tampered = Buffer.from(body.toString().replace('49900', '100'));
    expect(() => g.verifyWebhook(tampered, { 'x-razorpay-signature': sig })).toThrow(WebhookSignatureError);
    expect(() => g.verifyWebhook(body, {})).toThrow(WebhookSignatureError);
  });

  it('verifies the checkout callback signature', () => {
    const g = new RazorpayGateway(rzpCreds);
    const good = createHmac('sha256', rzpCreds.keySecret).update('order_Rz1|pay_1').digest('hex');
    expect(g.verifyCheckoutSignature('order_Rz1', 'pay_1', good)).toBe(true);
    expect(g.verifyCheckoutSignature('order_Rz1', 'pay_2', good)).toBe(false);
  });

  it('surfaces API errors', async () => {
    const g = new RazorpayGateway(rzpCreds, (async () => new Response(JSON.stringify({ error: { description: 'Authentication failed' } }), { status: 401 })) as typeof fetch);
    await expect(g.createPayment({ amountMinor: 1, currency: 'INR', orderId: 'o', receipt: 'r', idempotencyKey: 'k' })).rejects.toThrow('Authentication failed');
    expect(await g.testConnection()).toEqual({ ok: false, error: 'Razorpay: Authentication failed' });
  });
});

describe('StripeGateway', () => {
  const creds = { secretKey: 'sk_test_123', publishableKey: 'pk_test_123', webhookSecret: 'whsec_test_789' };

  it('creates PaymentIntents with an idempotency key through the official SDK', async () => {
    const seen: { url?: string; headers?: Headers; body?: string } = {};
    const g = new StripeGateway(creds, {
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        seen.url = String(url);
        seen.headers = new Headers(init?.headers);
        seen.body = String(init?.body);
        return new Response(JSON.stringify({ id: 'pi_1', object: 'payment_intent', client_secret: 'pi_1_secret_x', amount: 1999, currency: 'usd' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });
    const p = await g.createPayment({ amountMinor: 1999, currency: 'USD', orderId: 'o1', receipt: '#1', idempotencyKey: 'idem-1' });
    expect(seen.url).toContain('/v1/payment_intents');
    expect(seen.headers!.get('idempotency-key')).toBe('idem-1');
    expect(seen.body).toContain('amount=1999');
    expect(seen.body).toContain('currency=usd');
    expect(p.clientParams).toEqual({ provider: 'stripe', publishableKey: 'pk_test_123', clientSecret: 'pi_1_secret_x' });
  });

  it('verifies Stripe-Signature with the SDK and normalises payment events', () => {
    const g = new StripeGateway(creds);
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', object: 'payment_intent', amount: 1999, amount_received: 1999, currency: 'usd', latest_charge: 'ch_1' } } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: creds.webhookSecret });
    expect(g.verifyWebhook(Buffer.from(payload), { 'stripe-signature': header })).toMatchObject({ eventId: 'evt_1', type: 'payment.succeeded', providerOrderId: 'pi_1', providerPaymentId: 'ch_1', amountMinor: 1999, currency: 'USD' });
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' });
    expect(() => g.verifyWebhook(Buffer.from(payload), { 'stripe-signature': forged })).toThrow(WebhookSignatureError);
  });
});
