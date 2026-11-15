import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { ProviderRouter, ScriptedProvider } from '@mya/ai';
import { RazorpayBilling, StripeBilling } from '@mya/payments';
import { BILLING_PROVIDERS } from '../src/billing/billing.service.js';
import { PaygService } from '../src/billing/payg.service.js';
import { CreditsService } from '../src/credits/credits.service.js';
import { premiumRouter } from '../src/ai/premium.js';
import { FlagsService } from '../src/flags/flags.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

const RZP = { keyId: 'rzp_test_platform', keySecret: 'platform_key_secret', webhookSecret: 'platform_rzp_whsec' };
const STRIPE_WHSEC = 'whsec_platform_test';

/** Emulated provider HTTP APIs: the real billing classes build every request and verify every signature. */
const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
let seq = 0;
let declineNextCharge = false;
const form = (raw: string) => Object.fromEntries(new URLSearchParams(raw));
const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? 'GET';
  const raw = init?.body ? String(init.body) : '';
  const body = (raw.startsWith('{') ? JSON.parse(raw) : form(raw)) as Record<string, unknown>;
  calls.push({ method, url: u, body });
  if (u === 'https://api.razorpay.com/v1/customers') return Response.json({ id: 'cust_rzp_1' });
  if (u === 'https://api.razorpay.com/v1/orders') return Response.json({ id: `order_${++seq}`, amount: body.amount, currency: body.currency });
  if (u === 'https://api.razorpay.com/v1/payments/create/recurring') return Response.json({ razorpay_payment_id: `pay_${++seq}` });
  if (u.startsWith('https://api.stripe.com/v1/customers')) return Response.json({ id: 'cus_payg_1', object: 'customer' });
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions')) return Response.json({ id: `cs_setup_${++seq}`, object: 'checkout.session', url: `https://checkout.stripe.com/c/setup/${seq}` });
  if (u.startsWith('https://api.stripe.com/v1/setup_intents/seti_1')) return Response.json({ id: 'seti_1', object: 'setup_intent', status: 'succeeded', payment_method: { id: 'pm_card_1', object: 'payment_method', card: { brand: 'visa', last4: '4242' } } });
  if (u.startsWith('https://api.stripe.com/v1/payment_intents')) {
    if (declineNextCharge) {
      declineNextCharge = false;
      return Response.json({ error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } }, { status: 402 });
    }
    return Response.json({ id: `pi_payg_${++seq}`, object: 'payment_intent', status: 'processing' });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const providers = { razorpay: new RazorpayBilling(RZP, fakeFetch), stripe: new StripeBilling({ secretKey: 'sk_test_platform', webhookSecret: STRIPE_WHSEC }, { fetch: fakeFetch }) };

let app: INestApplication;
let prisma: PrismaClient;
let credits: CreditsService;
let payg: PaygService;
const http = () => request(app.getHttpServer());
const V = '/api/v1';

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ env: { BILLING_RATE_LIMIT_PER_MINUTE: '1000' }, overrides: [{ provide: BILLING_PROVIDERS, useValue: providers }] }));
  credits = app.get(CreditsService);
  payg = app.get(PaygService);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  calls.length = 0;
  declineNextCharge = false;
  await resetDb(prisma, { includedCredits: 100, maxProjects: 1, dailyCreditLimit: 60, maxCreditsPerRun: 80 });
  // Pay-as-you-go uses the smallest credit pack's price: 300 credits for $6 (2¢ each) and 300 for ₹499.
  await prisma.creditPack.createMany({ data: [{ name: '300 credits', credits: 300, priceMinor: 600, currency: 'USD' }, { name: '300 credits', credits: 300, priceMinor: 49_900, currency: 'INR' }, { name: '1,000 credits', credits: 1000, priceMinor: 149_900, currency: 'INR' }] });
});

async function login(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { id: u.id, email: u.email, auth, orgId: me.body.personalOrgId as string };
}
const view = async (auth: string) => (await http().get(`${V}/billing/payg`).set('Authorization', auth).expect(200)).body;
async function sendStripe(evt: object) {
  const payload = JSON.stringify(evt);
  return (await http().post(`${V}/webhooks/billing/stripe`).set({ 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WHSEC }), 'content-type': 'application/json' }).send(payload).expect(200)).body;
}
async function sendRzp(event: string, payload: object) {
  const raw = JSON.stringify({ event, payload });
  const headers = { 'content-type': 'application/json', 'x-razorpay-event-id': `evt_${randomUUID()}`, 'x-razorpay-signature': createHmac('sha256', RZP.webhookSecret).update(raw).digest('hex') };
  return (await http().post(`${V}/webhooks/billing/razorpay`).set(headers).send(raw).expect(200)).body;
}
/** Records AI usage the way a run does (allowance → purchased → pay-as-you-go). */
async function use(orgId: string, amount: number) {
  await prisma.$transaction((tx) => credits.debit(tx, orgId, amount, `test:${randomUUID()}`, { type: 'ai_usage', id: randomUUID() }));
}
async function stripeCard(a: { auth: string; id: string }, cap = 2000) {
  await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'USD', monthlyCapMinor: cap }).expect(201);
  const sessionId = (await prisma.paygAccount.findFirstOrThrow({ where: { createdById: a.id } })).setupRef!;
  return sendStripe({ id: `evt_${randomUUID()}`, object: 'event', type: 'checkout.session.completed', data: { object: { id: sessionId, object: 'checkout.session', mode: 'setup', customer: 'cus_payg_1', setup_intent: 'seti_1', status: 'complete' } } });
}
const piEvent = (type: string, id: string, amount: number, extra: object = {}) => ({ id: `evt_${randomUUID()}`, object: 'event', type, data: { object: { id, object: 'payment_intent', amount, amount_received: amount, currency: 'usd', customer: 'cus_payg_1', metadata: { kind: 'payg_charge' }, ...extra } } });

describe('pay-as-you-go with Stripe', () => {
  it('saving a card unlocks nothing until the verified webhook; then usage past credits is owed up to the cap', async () => {
    const a = await login('payg');
    expect(await view(a.auth)).toMatchObject({ status: 'none', active: false, currencies: [{ currency: 'INR', available: true }, { currency: 'USD', available: true, rate: { credits: 300, priceMinor: 600 } }] });
    const setup = (await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'USD', monthlyCapMinor: 2000 }).expect(201)).body;
    expect(setup).toMatchObject({ provider: 'stripe', checkoutUrl: expect.stringContaining('checkout.stripe.com') });
    const session = calls.find((c) => c.url.includes('/checkout/sessions'))!;
    expect(session.body).toMatchObject({ mode: 'setup', customer: 'cus_payg_1', currency: 'usd', 'metadata[kind]': 'payg_setup' });

    // Pending: no Premium AI, no spending past credits, nothing the browser can do to change that.
    expect(await view(a.auth)).toMatchObject({ status: 'pending', active: false, cardSaved: false });
    await http().post(`${V}/billing/payg/settings`).set('Authorization', a.auth).send({ premiumAi: true }).expect(400);
    await expect(credits.assertCanSpend(a.orgId, 150)).rejects.toMatchObject({ status: 402 });

    const acct = await prisma.paygAccount.findFirstOrThrow();
    expect((await sendStripe({ id: 'evt_setup_1', object: 'event', type: 'checkout.session.completed', data: { object: { id: acct.setupRef, object: 'checkout.session', mode: 'setup', customer: 'cus_payg_1', setup_intent: 'seti_1' } } })).outcome).toBe('payg_activated');
    // $20 cap at 2¢ a credit = 1,000 credits a month on top of the plan.
    expect(await view(a.auth)).toMatchObject({ status: 'active', active: true, cardLabel: 'Visa •••• 4242', capCredits: 1000, headroom: 1000, owedCredits: 0 });

    await use(a.orgId, 150); // 100 from the Free allowance, 50 owed
    const v = await view(a.auth);
    expect(v).toMatchObject({ owedCredits: 50, owedMinor: 100, usedThisMonth: 50, headroom: 950 });
    expect((await credits.balances(a.orgId)).total).toBe(0);
    await credits.assertCanSpend(a.orgId, 900);
    await expect(credits.assertCanSpend(a.orgId, 1000)).rejects.toMatchObject({ response: { code: 'payg_cap_reached' } });

    // A card lifts the Free plan's daily limit and per-run cap; the generation estimate says so.
    const p = (await http().post(`${V}/projects`).set('Authorization', a.auth).send({ name: 'Shop', type: 'website' }).expect(201)).body;
    void p;
    const est = (await http().get(`${V}/generations/estimate`).set('Authorization', a.auth).expect(200)).body;
    expect(est).toMatchObject({ balance: 0, spendable: 950, maxCreditsPerRun: 500, payg: { active: true, headroom: 950 } });
  });

  it('charges owed usage off-session once it reaches the threshold, and only the verified webhook settles it', async () => {
    const a = await login('charge');
    expect((await stripeCard(a)).outcome).toBe('payg_activated');
    await use(a.orgId, 150);
    expect((await payg.runBilling())[a.orgId]).toBe('not_due'); // $1 owed, below the $5 threshold, all from this month
    await use(a.orgId, 200); // 250 owed = $5.00
    expect((await payg.runBilling())[a.orgId]).toBe('charge_started');
    const pi = calls.find((c) => c.url.includes('/payment_intents'))!;
    expect(pi.body).toMatchObject({ amount: '500', currency: 'usd', customer: 'cus_payg_1', payment_method: 'pm_card_1', off_session: 'true', confirm: 'true', 'metadata[kind]': 'payg_charge' });
    expect((await payg.runBilling())[a.orgId]).toBe('already_pending');
    const charge = await prisma.paygCharge.findFirstOrThrow();
    expect(charge).toMatchObject({ status: 'pending', amountMinor: 500, credits: 250 });

    expect((await sendStripe(piEvent('payment_intent.succeeded', charge.providerRef!, 499))).outcome).toBe('amount_mismatch');
    const ok = piEvent('payment_intent.succeeded', charge.providerRef!, 500);
    expect((await sendStripe(ok)).outcome).toBe('payg_charge_paid');
    expect((await sendStripe(ok)).duplicate).toBe(true);
    expect((await sendStripe({ ...ok, id: 'evt_again' })).outcome).toBe('already_settled');
    const v = await view(a.auth);
    expect(v).toMatchObject({ owedCredits: 0, usedThisMonth: 250, headroom: 750, charges: [{ status: 'paid', amountMinor: 500, credits: 250 }] });
    const inv = await prisma.invoice.findFirstOrThrow({ where: { organizationId: a.orgId } });
    expect(inv).toMatchObject({ totalMinor: 500, currency: 'USD', description: 'Pay-as-you-go AI usage (250 credits)', providerPaymentId: charge.providerRef });
  });

  it('a failed payment pauses pay-as-you-go and Premium AI until the customer pays', async () => {
    const a = await login('fail');
    await stripeCard(a);
    await http().post(`${V}/billing/payg/settings`).set('Authorization', a.auth).send({ premiumAi: true }).expect(200);
    await use(a.orgId, 400);
    await payg.runBilling();
    const charge = await prisma.paygCharge.findFirstOrThrow();
    expect((await sendStripe(piEvent('payment_intent.payment_failed', charge.providerRef!, 600, { last_payment_error: { message: 'Insufficient funds.' } }))).outcome).toBe('payg_charge_failed');
    expect(await view(a.auth)).toMatchObject({ status: 'past_due', active: false, premiumAi: false, headroom: 0, owedCredits: 300, lastError: 'Insufficient funds.' });
    await expect(credits.assertCanSpend(a.orgId, 5)).rejects.toMatchObject({ response: { message: expect.stringContaining("didn't go through") } });
    expect((await payg.runBilling())[a.orgId]).toBe('retry_later'); // automatic retries wait 72 h

    // Declined straight away by the provider: recorded as failed with nothing taken.
    declineNextCharge = true;
    await http().post(`${V}/billing/payg/pay`).set('Authorization', a.auth).send({}).expect(200);
    expect((await prisma.paygCharge.findMany({ orderBy: { createdAt: 'desc' } }))[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('declined') });

    await http().post(`${V}/billing/payg/pay`).set('Authorization', a.auth).send({}).expect(200);
    const retry = (await prisma.paygCharge.findMany({ orderBy: { createdAt: 'desc' } }))[0]!;
    expect(retry).toMatchObject({ status: 'pending', amountMinor: 600, credits: 300 });
    await http().post(`${V}/billing/payg/pay`).set('Authorization', a.auth).send({}).expect(409);
    expect((await sendStripe(piEvent('payment_intent.succeeded', retry.providerRef!, 600))).outcome).toBe('payg_charge_paid');
    expect(await view(a.auth)).toMatchObject({ status: 'active', active: true, owedCredits: 0, lastError: null });
  });

  it('only the owner manages it, caps are bounded, and switching off stops new usage but not what is owed', async () => {
    const a = await login('owner');
    await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'USD', monthlyCapMinor: 50 }).expect(400);
    await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'USD', monthlyCapMinor: 10_000_000 }).expect(400);
    await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'EUR', monthlyCapMinor: 2000 }).expect(400);
    const stranger = await login('stranger');
    await http().post(`${V}/billing/payg/setup`).set('Authorization', stranger.auth).send({ currency: 'USD', monthlyCapMinor: 2000, organizationId: a.orgId }).expect(404);
    await http().get(`${V}/billing/payg?organizationId=${a.orgId}`).set('Authorization', stranger.auth).expect(404);
    // A forged "setup completed" for an unknown session changes nothing.
    expect((await sendStripe({ id: 'evt_x', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_forged', object: 'checkout.session', mode: 'setup', customer: 'cus_x', setup_intent: 'seti_1' } } })).outcome).toBe('unknown_card_setup');

    await stripeCard(a);
    await use(a.orgId, 110); // 10 owed = 20¢: below the $1 minimum, so it rolls over
    const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 2));
    expect((await payg.runBilling(nextMonth))[a.orgId]).toBe('not_due');
    await use(a.orgId, 50);
    await http().post(`${V}/billing/payg/disable`).set('Authorization', a.auth).send({}).expect(200);
    expect(await view(a.auth)).toMatchObject({ status: 'disabled', active: false, owedCredits: 60 });
    await expect(credits.assertCanSpend(a.orgId, 5)).rejects.toMatchObject({ status: 402 });
    // Still charged at the start of next month.
    expect((await payg.runBilling(nextMonth))[a.orgId]).toBe('charge_started');
    expect((await prisma.paygCharge.findFirstOrThrow()).amountMinor).toBe(120);
    await http().post(`${V}/billing/payg/enable`).set('Authorization', a.auth).send({}).expect(200);
  });

  it('the flag switches new cards off', async () => {
    const owner = await login('flagowner');
    const flags = app.get(FlagsService);
    await flags.set({ id: owner.id } as never, 'pay_as_you_go', false);
    try {
      expect((await http().post(`${V}/billing/payg/setup`).set('Authorization', owner.auth).send({ currency: 'USD', monthlyCapMinor: 2000 }).expect(503)).body.code).toBe('feature_disabled');
      expect((await view(owner.auth)).enabled).toBe(false);
    } finally {
      await flags.set({ id: owner.id } as never, 'pay_as_you_go', true);
    }
  });
});

describe('pay-as-you-go with Razorpay card mandates', () => {
  it('₹1 card check, confirmed token, then a recurring debit settled by the verified webhook', async () => {
    const a = await login('rzp');
    const setup = (await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'INR', monthlyCapMinor: 500_000 }).expect(201)).body;
    expect(setup).toMatchObject({ provider: 'razorpay', keyId: RZP.keyId, customerId: 'cust_rzp_1', recurring: 1, amount: 100, currency: 'INR' });
    const order = calls.find((c) => c.url.endsWith('/orders'))!;
    expect(order.body).toMatchObject({ amount: 100, currency: 'INR', customer_id: 'cust_rzp_1', method: 'card', token: { max_amount: 500_000, frequency: 'as_presented' }, notes: { kind: 'payg_setup' } });

    const setupOrder = setup.orderId as string;
    const payment = { id: 'pay_check_1', amount: 100, currency: 'INR', order_id: setupOrder, token_id: 'token_1', customer_id: 'cust_rzp_1', card: { network: 'Visa', last4: '1111' } };
    expect((await sendRzp('payment.captured', { payment: { entity: payment } })).outcome).toBe('card_check_paid');
    // order.paid for the card check is not a credit top-up.
    expect((await sendRzp('order.paid', { order: { entity: { id: setupOrder } }, payment: { entity: payment } })).outcome).toBe('card_check_paid');
    expect(await view(a.auth)).toMatchObject({ status: 'pending', active: false, cardLabel: 'Visa •••• 1111' });
    expect((await credits.balances(a.orgId)).purchased).toBe(0);

    expect((await sendRzp('token.confirmed', { token: { entity: { id: 'token_1', customer_id: 'cust_rzp_1' } } })).outcome).toBe('payg_activated');
    // ₹5,000 cap at ₹499 per 300 credits = 3,006 credits.
    expect(await view(a.auth)).toMatchObject({ status: 'active', active: true, capCredits: 3006 });

    // Usage from last month is charged at the start of this month even below the threshold.
    await use(a.orgId, 100);
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15));
    await prisma.creditLedgerEntry.create({ data: { organizationId: a.orgId, amount: -60, reason: 'ai_usage', bucket: 'payg', idempotencyKey: `old:${a.orgId}`, createdAt: lastMonth } });
    calls.length = 0;
    expect((await payg.runBilling())[a.orgId]).toBe('charge_started');
    const debitOrder = calls.find((c) => c.url.endsWith('/orders'))!;
    expect(debitOrder.body).toMatchObject({ amount: 9980, currency: 'INR', payment_capture: 1, notes: { kind: 'payg_charge' } });
    const rec = calls.find((c) => c.url.endsWith('/payments/create/recurring'))!;
    expect(rec.body).toMatchObject({ amount: 9980, currency: 'INR', customer_id: 'cust_rzp_1', token: 'token_1', recurring: '1', email: a.email });

    const charge = await prisma.paygCharge.findFirstOrThrow();
    const debit = { id: 'pay_debit_1', amount: 9980, currency: 'INR', order_id: charge.providerRef, customer_id: 'cust_rzp_1', fee: 200, tax: 36 };
    expect((await sendRzp('payment.captured', { payment: { entity: debit } })).outcome).toBe('payg_charge_paid');
    expect((await sendRzp('order.paid', { order: { entity: { id: charge.providerRef } }, payment: { entity: debit } })).outcome).toBe('already_settled');
    expect(await view(a.auth)).toMatchObject({ owedCredits: 0, charges: [{ status: 'paid', amountMinor: 9980 }] });
    expect(await prisma.invoice.findFirstOrThrow({ where: { organizationId: a.orgId } })).toMatchObject({ totalMinor: 9980, feeMinor: 200, provider: 'razorpay' });
  });

  it('a rejected mandate leaves the card unusable and explains why', async () => {
    const a = await login('rzpreject');
    await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'INR', monthlyCapMinor: 100_000 }).expect(201);
    expect((await sendRzp('token.rejected', { token: { entity: { id: 'token_9', customer_id: 'cust_rzp_1' } } })).outcome).toBe('card_rejected');
    expect(await view(a.auth)).toMatchObject({ status: 'pending', active: false, lastError: expect.stringContaining("didn't approve") });
    await http().post(`${V}/billing/payg/setup`).set('Authorization', a.auth).send({ currency: 'INR', monthlyCapMinor: 2_000_000 }).expect(400); // above ₹15,000
  });
});

describe('Premium AI', () => {
  it('sends balanced steps to the deep tier, keeps fast steps fast, and falls back when no deep route exists', async () => {
    const std = new ScriptedProvider('std', ['{"a":1}', '{"a":2}', '{"a":3}']);
    const top = new ScriptedProvider('top', ['{"a":9}']);
    const route = (provider: string, tier: 'fast' | 'balanced' | 'deep') => ({ provider, model: `${provider}-m`, tier, priority: 10, inputCostPerMTokMicros: 1, outputCostPerMTokMicros: 1, enabled: true });
    const router = new ProviderRouter([std, top], [route('std', 'fast'), route('std', 'balanced'), route('top', 'deep')]);
    const req = { system: 's', messages: [{ role: 'user' as const, content: 'x' }], maxOutputTokens: 100 };
    const premium = premiumRouter(router);
    expect((await premium.complete(req, { tier: 'balanced' })).provider).toBe('top');
    expect((await premium.complete(req, { tier: 'fast' })).provider).toBe('std');
    expect(premium.candidates('deep')).toHaveLength(1);
    const noDeep = new ProviderRouter([std], [route('std', 'balanced')]);
    expect(premiumRouter(noDeep)).toBe(noDeep);
  });
});
