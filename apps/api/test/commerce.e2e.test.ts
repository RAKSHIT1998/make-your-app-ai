import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { RazorpayGateway, StripeGateway, type GatewayCredentials } from '@mya/payments';
import { GATEWAY_FACTORY } from '../src/commerce/gateways.js';
import { StorefrontService } from '../src/commerce/storefront.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

/**
 * Real gateway classes (real signature verification, real request building) talking to an in-process
 * emulation of the providers' HTTP APIs. Nothing here bypasses the verification code under test.
 */
const providerCalls: { url: string; body: unknown }[] = [];
let rzpSeq = 0;
const fakeProviderFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  const body = init?.body ? (String(init.body).startsWith('{') ? JSON.parse(String(init.body)) : String(init.body)) : null;
  providerCalls.push({ url: u, body });
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  const basicUser = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString().split(':')[0] : '';
  if (u.startsWith('https://api.razorpay.com')) {
    if (basicUser !== 'rzp_test_good') return new Response(JSON.stringify({ error: { description: 'Authentication failed' } }), { status: 401 });
    if (u.endsWith('/orders') && init?.method === 'POST') return Response.json({ id: `order_T${++rzpSeq}`, amount: (body as { amount: number }).amount, currency: (body as { currency: string }).currency, status: 'created' });
    if (u.includes('/refund')) return Response.json({ id: `rfnd_${++rzpSeq}`, status: 'processed' });
    if (u.includes('/orders?count=1')) return Response.json({ items: [] });
  }
  if (u.includes('api.stripe.com')) {
    if (u.includes('/v1/balance')) return Response.json({ object: 'balance', available: [] });
    if (u.includes('/v1/payment_intents')) return Response.json({ id: `pi_T${++rzpSeq}`, object: 'payment_intent', client_secret: `pi_secret_${rzpSeq}`, amount: 0, currency: 'usd' });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const factory = (creds: GatewayCredentials) =>
  creds.provider === 'razorpay' ? new RazorpayGateway(creds, fakeProviderFetch) : new StripeGateway(creds, { fetch: fakeProviderFetch });

const RZP = { provider: 'razorpay', keyId: 'rzp_test_good', keySecret: 'rzp_key_secret_value', webhookSecret: 'rzp_webhook_secret' } as const;
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());
const V = '/api/v1';

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ env: { ENCRYPTION_KEY, RATE_LIMIT_PER_MINUTE: '100000', CHECKOUT_RATE_LIMIT_PER_MINUTE: '100000' }, overrides: [{ provide: GATEWAY_FACTORY, useValue: factory }] }));
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  providerCalls.length = 0;
  await resetDb(prisma);
});

async function login(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { ...u, auth, orgId: me.body.personalOrgId as string };
}

/** A live store: 2 variants (5 + 2 units), standard shipping, a 10% code, 18% GST inclusive, Razorpay connected. */
async function setupStore() {
  const owner = await login('owner');
  const store = (await http().post(`${V}/stores`).set('Authorization', owner.auth).send({ name: 'Kashmir Dry Fruits', currency: 'INR', taxRateBps: 1800, pricesIncludeTax: true }).expect(201)).body;
  const product = (await http().post(`${V}/stores/${store.id}/products`).set('Authorization', owner.auth).send({
    title: 'Premium Walnuts', status: 'active', tags: ['nuts'],
    variants: [
      { title: '500 g', sku: 'WAL-500', priceMinor: 59900, options: { size: '500 g' }, inventory: { onHand: 5 } },
      { title: '1 kg', sku: 'WAL-1000', priceMinor: 109900, options: { size: '1 kg' }, inventory: { onHand: 2 } },
    ],
  }).expect(201)).body;
  const shipping = (await http().post(`${V}/stores/${store.id}/shipping`).set('Authorization', owner.auth).send({ name: 'Standard', rateMinor: 9900, freeOverMinor: 150000, countries: ['IN'] }).expect(201)).body;
  await http().post(`${V}/stores/${store.id}/discounts`).set('Authorization', owner.auth).send({ code: 'WELCOME10', type: 'percentage', value: 1000, usageLimit: 100 }).expect(201);
  await http().put(`${V}/stores/${store.id}/payments`).set('Authorization', owner.auth).send(RZP).expect(200);
  await http().patch(`${V}/stores/${store.id}`).set('Authorization', owner.auth).send({ status: 'active' }).expect(200);
  const [small, large] = product.variants as { id: string }[];
  return { owner, store, product, small: small!.id, large: large!.id, shipping: shipping.id as string };
}

const address = { name: 'Asha Bhat', line1: '12 Boulevard Rd', city: 'Srinagar', postalCode: '190001', country: 'IN' };
function checkoutBody(over: Record<string, unknown>) {
  return { checkoutToken: randomUUID() + randomUUID(), email: 'buyer@example.com', shippingAddress: address, ...over };
}
function signRzp(body: object, eventId = `evt_${randomUUID()}`) {
  const raw = JSON.stringify(body);
  return { raw, headers: { 'x-razorpay-signature': createHmac('sha256', RZP.webhookSecret).update(raw).digest('hex'), 'x-razorpay-event-id': eventId, 'content-type': 'application/json' } };
}
function captured(rzpOrderId: string, amount: number, paymentId = `pay_${randomUUID().slice(0, 8)}`) {
  return { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: rzpOrderId, amount, currency: 'INR', status: 'captured' } } } };
}
async function inventory(variantId: string) {
  return prisma.inventory.findUniqueOrThrow({ where: { variantId } });
}

describe('merchant catalog & access control', () => {
  it('creates a store with products, variants, inventory, shipping and discounts; enforces roles and tenancy', async () => {
    const { owner, store } = await setupStore();
    const products = (await http().get(`${V}/stores/${store.id}/products`).set('Authorization', owner.auth).expect(200)).body;
    expect(products[0].variants.map((v: { sku: string; inventory: { onHand: number } }) => [v.sku, v.inventory.onHand])).toEqual([['WAL-500', 5], ['WAL-1000', 2]]);

    const outsider = await login('outsider');
    await http().get(`${V}/stores/${store.id}`).set('Authorization', outsider.auth).expect(404);
    await http().post(`${V}/stores/${store.id}/products`).set('Authorization', outsider.auth).send({ title: 'x', variants: [{ priceMinor: 1 }] }).expect(404);

    const viewer = await login('viewer');
    await prisma.organizationMembership.create({ data: { organizationId: owner.orgId, userId: viewer.id, role: 'viewer' } });
    await http().get(`${V}/stores/${store.id}/products`).set('Authorization', viewer.auth).expect(200);
    await http().post(`${V}/stores/${store.id}/products`).set('Authorization', viewer.auth).send({ title: 'x', variants: [{ priceMinor: 1 }] }).expect(403);

    await http().post(`${V}/stores/${store.id}/products`).set('Authorization', owner.auth).send({ title: 'Dup', variants: [{ priceMinor: 1, sku: 'WAL-500' }] }).expect(409);
  });

  it('never returns payment secrets, and stores them encrypted', async () => {
    const { owner, store } = await setupStore();
    const res = await http().get(`${V}/stores/${store.id}`).set('Authorization', owner.auth).expect(200);
    expect(res.body.payments).toMatchObject({ provider: 'razorpay', status: 'connected', webhookUrl: expect.stringContaining(`/api/v1/webhooks/payments/razorpay/${store.id}`) });
    expect(JSON.stringify(res.body)).not.toContain(RZP.keySecret);
    const integ = await prisma.integration.findFirstOrThrow({ where: { organizationId: owner.orgId, provider: 'razorpay' } });
    expect(integ.encryptedCreds).not.toContain(RZP.keySecret);
  });

  it('rejects payment credentials that fail the live connection test', async () => {
    const owner = await login('o2');
    const store = (await http().post(`${V}/stores`).set('Authorization', owner.auth).send({ name: 'S' }).expect(201)).body;
    const res = await http().put(`${V}/stores/${store.id}/payments`).set('Authorization', owner.auth).send({ ...RZP, keyId: 'rzp_test_bad' }).expect(422);
    expect(res.body.message).toContain('Authentication failed');
  });
});

describe('storefront checkout', () => {
  it('hides draft stores, shows availability not stock counts, and prices carts correctly', async () => {
    const owner = await login('d');
    const draft = (await http().post(`${V}/stores`).set('Authorization', owner.auth).send({ name: 'Draft' }).expect(201)).body;
    await http().get(`${V}/storefront/${draft.slug}`).expect(404);

    const { store, small, shipping } = await setupStore();
    const products = (await http().get(`${V}/storefront/${store.slug}/products?q=walnut`).expect(200)).body;
    expect(products[0].variants[0]).toMatchObject({ sku: 'WAL-500', available: true });
    expect(JSON.stringify(products)).not.toContain('onHand');

    // 2 × 599.00 = 1198.00, −10% = 1078.20, shipping 99 (under 1500 free threshold), GST 18% included in goods.
    const q = (await http().post(`${V}/storefront/${store.slug}/quote`).send({ items: [{ variantId: small, quantity: 2 }], discountCode: 'welcome10', shippingId: shipping }).expect(200)).body;
    expect(q).toMatchObject({ currency: 'INR', subtotalMinor: 119800, discountMinor: 11980, shippingMinor: 9900, taxMinor: 16447, totalMinor: 117720 });
    await http().post(`${V}/storefront/${store.slug}/quote`).send({ items: [{ variantId: small, quantity: 1 }], discountCode: 'NOPE1', shippingId: shipping }).expect(422);
  });

  it('reserves stock, opens a Razorpay order, and is idempotent per checkout token', async () => {
    const { store, small, shipping } = await setupStore();
    const body = checkoutBody({ items: [{ variantId: small, quantity: 2 }], shippingId: shipping, discountCode: 'WELCOME10' });
    const first = (await http().post(`${V}/storefront/${store.slug}/checkout`).send(body).expect(201)).body;
    expect(first).toMatchObject({ number: 1001, status: 'pending_payment', totalMinor: 117720, payment: { provider: 'razorpay', keyId: 'rzp_test_good', amount: 117720, currency: 'INR' } });
    expect(JSON.stringify(first)).not.toContain(RZP.keySecret);
    expect(await inventory(small)).toMatchObject({ onHand: 5, reserved: 2 });

    const again = (await http().post(`${V}/storefront/${store.slug}/checkout`).send(body).expect(201)).body;
    expect(again.id).toBe(first.id);
    expect(providerCalls.filter((c) => c.url.endsWith('/v1/orders'))).toHaveLength(1);
    expect(await inventory(small)).toMatchObject({ reserved: 2 });
    expect((await prisma.discount.findFirstOrThrow({ where: { code: 'WELCOME10' } })).usageCount).toBe(1);
  });

  it('never oversells under concurrent checkouts', async () => {
    const { store, large, shipping } = await setupStore(); // 2 units of the 1 kg pack
    const results = await Promise.all(Array.from({ length: 6 }, () => http().post(`${V}/storefront/${store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: large, quantity: 1 }], shippingId: shipping }))));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(2);
    expect(codes.filter((c) => c === 409)).toHaveLength(4);
    expect(await inventory(large)).toMatchObject({ onHand: 2, reserved: 2 });
    const numbers = results.filter((r) => r.status === 201).map((r) => r.body.number).sort();
    expect(new Set(numbers).size).toBe(2);
  });

  it('marks orders paid only on a correctly signed webhook, exactly once, and settles stock', async () => {
    const { store, small, shipping } = await setupStore();
    const order = (await http().post(`${V}/storefront/${store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: small, quantity: 2 }], shippingId: shipping })).expect(201)).body;
    const rzpOrderId = order.payment.razorpayOrderId as string;
    const url = `${V}/webhooks/payments/razorpay/${store.id}`;

    const forged = signRzp(captured(rzpOrderId, order.totalMinor));
    await http().post(url).set({ ...forged.headers, 'x-razorpay-signature': 'f'.repeat(64) }).send(forged.raw).expect(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('pending_payment');

    const evt = signRzp(captured(rzpOrderId, order.totalMinor), 'evt_once');
    expect((await http().post(url).set(evt.headers).send(evt.raw).expect(200)).body).toEqual({ received: true, outcome: 'order_paid' });
    expect((await http().post(url).set(evt.headers).send(evt.raw).expect(200)).body).toEqual({ received: true, duplicate: true });
    const again = signRzp(captured(rzpOrderId, order.totalMinor), 'evt_retry_new_id');
    expect((await http().post(url).set(again.headers).send(again.raw).expect(200)).body.outcome).toBe('already_processed');

    expect(await inventory(small)).toMatchObject({ onHand: 3, reserved: 0 });
    const view = (await http().get(`${V}/storefront/${store.slug}/orders/${order.id}?token=${order.accessToken}`).expect(200)).body;
    expect(view.status).toBe('paid');
    await http().get(`${V}/storefront/${store.slug}/orders/${order.id}?token=wrong-token-value`).expect(404);
  });

  it('refuses to mark an order paid when the captured amount does not match', async () => {
    const { store, small, shipping } = await setupStore();
    const order = (await http().post(`${V}/storefront/${store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: small, quantity: 1 }], shippingId: shipping })).expect(201)).body;
    const evt = signRzp(captured(order.payment.razorpayOrderId, 100));
    expect((await http().post(`${V}/webhooks/payments/razorpay/${store.id}`).set(evt.headers).send(evt.raw).expect(200)).body.outcome).toBe('amount_mismatch');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('pending_payment');
  });

  it('confirms Razorpay checkout callbacks by signature', async () => {
    const { store, small, shipping } = await setupStore();
    const order = (await http().post(`${V}/storefront/${store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: small, quantity: 1 }], shippingId: shipping })).expect(201)).body;
    const rzpOrderId = order.payment.razorpayOrderId as string;
    const sig = createHmac('sha256', RZP.keySecret).update(`${rzpOrderId}|pay_cb1`).digest('hex');
    const base = { accessToken: order.accessToken, razorpayOrderId: rzpOrderId, razorpayPaymentId: 'pay_cb1' };
    await http().post(`${V}/storefront/${store.slug}/orders/${order.id}/razorpay/confirm`).send({ ...base, razorpaySignature: 'bad' }).expect(400);
    const ok = (await http().post(`${V}/storefront/${store.slug}/orders/${order.id}/razorpay/confirm`).send({ ...base, razorpaySignature: sig }).expect(200)).body;
    expect(ok).toMatchObject({ outcome: 'order_paid', order: { status: 'paid' } });
  });

  it('expires unpaid checkouts, releasing stock and discount usage', async () => {
    const { store, small, shipping } = await setupStore();
    const order = (await http().post(`${V}/storefront/${store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: small, quantity: 3 }], shippingId: shipping, discountCode: 'WELCOME10' })).expect(201)).body;
    expect(await inventory(small)).toMatchObject({ reserved: 3 });
    const released = await app.get(StorefrontService).releaseExpired(new Date(Date.now() + 31 * 60_000));
    expect(released).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('expired');
    expect(await inventory(small)).toMatchObject({ onHand: 5, reserved: 0 });
    expect((await prisma.discount.findFirstOrThrow({ where: { code: 'WELCOME10' } })).usageCount).toBe(0);
  });

  it('refuses checkout until payments are connected', async () => {
    const owner = await login('np');
    const store = (await http().post(`${V}/stores`).set('Authorization', owner.auth).send({ name: 'No Pay' }).expect(201)).body;
    const p = (await http().post(`${V}/stores/${store.id}/products`).set('Authorization', owner.auth).send({ title: 'E-book', digital: true, status: 'active', variants: [{ priceMinor: 19900, inventory: { tracked: false } }] }).expect(201)).body;
    await http().patch(`${V}/stores/${store.id}`).set('Authorization', owner.auth).send({ status: 'active' }).expect(200);
    const res = await http().post(`${V}/storefront/${store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: p.variants[0].id, quantity: 1 }], shippingAddress: undefined })).expect(503);
    expect(res.body.setupRequired).toBe(true);
  });
});

describe('orders after payment', () => {
  async function paidOrder() {
    const ctx = await setupStore();
    const order = (await http().post(`${V}/storefront/${ctx.store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: ctx.small, quantity: 2 }], shippingId: ctx.shipping })).expect(201)).body;
    const evt = signRzp(captured(order.payment.razorpayOrderId, order.totalMinor, 'pay_paid1'));
    await http().post(`${V}/webhooks/payments/razorpay/${ctx.store.id}`).set(evt.headers).send(evt.raw).expect(200);
    return { ...ctx, order };
  }

  it('refunds partially then fully with restock; blocks over-refunds; idempotent; admin only', async () => {
    const { owner, store, order, small } = await paidOrder();
    const member = await login('member');
    await prisma.organizationMembership.create({ data: { organizationId: owner.orgId, userId: member.id, role: 'member' } });
    const url = `${V}/stores/${store.id}/orders/${order.id}/refunds`;

    await http().post(url).set('Authorization', member.auth).send({ amountMinor: 1000, idempotencyKey: 'refund-member-1' }).expect(403);
    const r1 = (await http().post(url).set('Authorization', owner.auth).send({ amountMinor: 10000, reason: 'Damaged box', idempotencyKey: 'refund-part-1' }).expect(201)).body;
    expect(r1).toMatchObject({ status: 'succeeded', amountMinor: 10000 });
    const dup = (await http().post(url).set('Authorization', owner.auth).send({ amountMinor: 10000, idempotencyKey: 'refund-part-1' }).expect(201)).body;
    expect(dup.id).toBe(r1.id);
    expect(providerCalls.filter((c) => c.url.includes('/refund'))).toHaveLength(1);

    await http().post(url).set('Authorization', owner.auth).send({ amountMinor: order.totalMinor, idempotencyKey: 'refund-too-much' }).expect(400);
    await http().post(url).set('Authorization', owner.auth).send({ amountMinor: order.totalMinor - 10000, restock: true, idempotencyKey: 'refund-rest-1' }).expect(201);
    const final = (await http().get(`${V}/stores/${store.id}/orders/${order.id}`).set('Authorization', owner.auth).expect(200)).body;
    expect(final).toMatchObject({ status: 'refunded', refundedMinor: order.totalMinor });
    expect(await inventory(small)).toMatchObject({ onHand: 5, reserved: 0 });
  });

  it('fulfils paid orders and reports analytics from real orders', async () => {
    const { owner, store, order } = await paidOrder();
    await http().post(`${V}/stores/${store.id}/orders/${order.id}/fulfill`).set('Authorization', owner.auth).send({ trackingNumber: 'DTDC123' }).expect(201);
    await http().post(`${V}/stores/${store.id}/orders/${order.id}/fulfill`).set('Authorization', owner.auth).send({}).expect(409);
    const a = (await http().get(`${V}/stores/${store.id}/analytics?days=30`).set('Authorization', owner.auth).expect(200)).body;
    expect(a).toMatchObject({ currency: 'INR', orders: 1, grossSalesMinor: order.totalMinor, refundsMinor: 0, netSalesMinor: order.totalMinor, averageOrderValueMinor: order.totalMinor, pendingPaymentOrders: 0 });
    expect(a.topProducts[0]).toMatchObject({ productTitle: 'Premium Walnuts', units: 2 });
    expect(a.lowStock.map((l: { variantTitle: string }) => l.variantTitle)).toEqual(expect.arrayContaining(['500 g', '1 kg']));
  });
});

describe('Stripe stores', () => {
  it('connects Stripe and settles orders from a verified payment_intent.succeeded webhook', async () => {
    const owner = await login('stripe');
    const STRIPE = { provider: 'stripe', secretKey: 'sk_test_abc', publishableKey: 'pk_test_abc', webhookSecret: 'whsec_test_abc' };
    const store = (await http().post(`${V}/stores`).set('Authorization', owner.auth).send({ name: 'Brooklyn Tees', currency: 'USD' }).expect(201)).body;
    const p = (await http().post(`${V}/stores/${store.id}/products`).set('Authorization', owner.auth).send({ title: 'Tee', status: 'active', digital: true, variants: [{ title: 'M', priceMinor: 2500, inventory: { onHand: 10 } }] }).expect(201)).body;
    await http().put(`${V}/stores/${store.id}/payments`).set('Authorization', owner.auth).send(STRIPE).expect(200);
    await http().patch(`${V}/stores/${store.id}`).set('Authorization', owner.auth).send({ status: 'active' }).expect(200);
    const order = (await http().post(`${V}/storefront/${store.slug}/checkout`).send(checkoutBody({ items: [{ variantId: p.variants[0].id, quantity: 2 }], shippingAddress: undefined })).expect(201)).body;
    expect(order.payment).toMatchObject({ provider: 'stripe', publishableKey: 'pk_test_abc', clientSecret: expect.stringMatching(/^pi_secret_/) });

    const pi = (await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).providerOrderId;
    const payload = JSON.stringify({ id: 'evt_s1', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: pi, object: 'payment_intent', amount: 5000, amount_received: 5000, currency: 'usd', latest_charge: 'ch_1' } } });
    const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE.webhookSecret });
    await http().post(`${V}/webhooks/payments/stripe/${store.id}`).set({ 'stripe-signature': 'bad', 'content-type': 'application/json' }).send(payload).expect(400);
    expect((await http().post(`${V}/webhooks/payments/stripe/${store.id}`).set({ 'stripe-signature': sig, 'content-type': 'application/json' }).send(payload).expect(200)).body.outcome).toBe('order_paid');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('paid');
  });
});

