import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { RazorpayBilling, StripeBilling } from '@mya/payments';
import { BILLING_PROVIDERS } from '../src/billing/billing.service.js';
import { CreditsService } from '../src/credits/credits.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

const RZP = { keyId: 'rzp_live_platform', keySecret: 'platform_key_secret', webhookSecret: 'platform_rzp_whsec' };
const STRIPE_WHSEC = 'whsec_platform_test';
const OWNER_EMAIL = 'founder@makeyourapp.test';

/** Emulates the providers' HTTP APIs; the real billing classes build requests and verify signatures. */
const calls: { method: string; url: string; body: unknown }[] = [];
let seq = 0;
const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method ?? 'GET';
  const raw = init?.body ? String(init.body) : '';
  const body = raw.startsWith('{') ? JSON.parse(raw) : raw;
  calls.push({ method, url: u, body });
  if (u === 'https://api.razorpay.com/v1/plans') return Response.json({ id: `plan_${++seq}` });
  if (u === 'https://api.razorpay.com/v1/subscriptions') return Response.json({ id: `sub_${++seq}`, short_url: `https://rzp.io/i/${seq}` });
  if (/\/v1\/subscriptions\/.+\/cancel$/.test(u)) return Response.json({ id: 'x', status: 'cancelled' });
  if (u === 'https://api.razorpay.com/v1/orders') return Response.json({ id: `order_${++seq}`, amount: (body as { amount: number }).amount, currency: (body as { currency: string }).currency });
  if (u.includes('api.stripe.com/v1/checkout/sessions')) return Response.json({ id: `cs_test_${++seq}`, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/cs_test_${seq}` });
  if (u.includes('api.stripe.com/v1/subscriptions/')) return Response.json({ id: u.split('/').pop(), object: 'subscription', status: method === 'DELETE' ? 'canceled' : 'active' });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const providers = { razorpay: new RazorpayBilling(RZP, fakeFetch), stripe: new StripeBilling({ secretKey: 'sk_test_platform', webhookSecret: STRIPE_WHSEC }, { fetch: fakeFetch }) };

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());
const V = '/api/v1';

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ env: { PLATFORM_OWNER_EMAILS: OWNER_EMAIL, REPORTING_USD_INR: '85' }, overrides: [{ provide: BILLING_PROVIDERS, useValue: providers }] }));
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** Plans as an owner would configure them. */
async function seedPlans() {
  const creator = await prisma.plan.create({ data: { code: 'creator', name: 'Creator', sortOrder: 1, includedCredits: 480, maxProjects: 3, maxCreditsPerRun: 150, featureFlags: ['website_generation'], projectTypes: ['website', 'business_website', 'ecommerce'], prices: { create: [{ interval: 'monthly', currency: 'INR', amountMinor: 99_900 }] } }, include: { prices: true } });
  const pro = await prisma.plan.create({ data: { code: 'pro', name: 'Pro', sortOrder: 2, includedCredits: 1200, maxProjects: 10, maxCreditsPerRun: 300, featureFlags: ['full_stack'], projectTypes: ['website', 'business_website', 'ecommerce', 'mobile_app', 'saas', 'custom_software'], prices: { create: [{ interval: 'monthly', currency: 'INR', amountMinor: 249_900 }, { interval: 'monthly', currency: 'USD', amountMinor: 2900, stripePriceId: 'price_pro_usd' }] } }, include: { prices: true } });
  const pack = await prisma.creditPack.create({ data: { name: '300 credits', credits: 300, priceMinor: 49_900, currency: 'INR' } });
  return { creatorInr: creator.prices[0]!.id, proInr: pro.prices.find((p) => p.currency === 'INR')!.id, proUsd: pro.prices.find((p) => p.currency === 'USD')!.id, pack: pack.id };
}

beforeEach(async () => {
  calls.length = 0;
  await resetDb(prisma, { includedCredits: 100, maxProjects: 1, dailyCreditLimit: 60, maxCreditsPerRun: 80 });
});

async function login(label: string, email?: string) {
  const u = newIdentity(label);
  const mail = email ?? u.email;
  const auth = `Bearer ${await tokenFor(u.id, mail)}`;
  const me = await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { id: u.id, email: mail, auth, orgId: me.body.personalOrgId as string, me: me.body };
}

function rzpEvent(event: string, payload: object, eventId = `evt_${randomUUID()}`) {
  const raw = JSON.stringify({ event, payload });
  return { raw, headers: { 'content-type': 'application/json', 'x-razorpay-event-id': eventId, 'x-razorpay-signature': createHmac('sha256', RZP.webhookSecret).update(raw).digest('hex') } };
}
const charged = (subId: string, amount: number, start: number, payId = `pay_${randomUUID().slice(0, 8)}`) =>
  ({ subscription: { entity: { id: subId, status: 'active', current_start: start, current_end: start + 30 * 86400, customer_id: 'cust_1' } }, payment: { entity: { id: payId, amount, currency: 'INR', fee: Math.round(amount * 0.02), tax: Math.round(amount * 0.0036) } } });
async function sendRzp(e: { raw: string; headers: Record<string, string> }) {
  return (await http().post(`${V}/webhooks/billing/razorpay`).set(e.headers).send(e.raw).expect(200)).body;
}
const overview = async (auth: string) => (await http().get(`${V}/billing/overview`).set('Authorization', auth).expect(200)).body;
const T0 = Math.floor(Date.UTC(2026, 10, 1) / 1000);

describe('plans & free tier', () => {
  it('lists public plans and credit packs without auth', async () => {
    await seedPlans();
    const res = (await http().get(`${V}/billing/plans`).expect(200)).body;
    expect(res.plans.map((p: { code: string }) => p.code)).toEqual(['free', 'creator', 'pro']);
    expect(res.plans[1].prices[0]).toMatchObject({ interval: 'monthly', currency: 'INR', amountMinor: 99_900 });
    expect(res.creditPacks[0]).toMatchObject({ credits: 300, priceMinor: 49_900 });
    expect(res.providers).toEqual({ razorpay: true, stripe: true });
  });

  it('starts new workspaces on Free with its allowance and enforces Free limits', async () => {
    const a = await login('free');
    const o = await overview(a.auth);
    expect(o).toMatchObject({ plan: { code: 'free', source: 'free' }, credits: { allowanceRemaining: 100, purchasedRemaining: 0 }, entitlements: { maxActiveProjects: 1 } });
    await http().post(`${V}/projects`).set('Authorization', a.auth).send({ name: 'One', type: 'website' }).expect(201);
    const second = await http().post(`${V}/projects`).set('Authorization', a.auth).send({ name: 'Two', type: 'website' }).expect(402);
    expect(second.body.code).toBe('plan_limit_projects');
  });
});

describe('subscriptions (Razorpay)', () => {
  it('only a verified webhook activates a paid plan — never the checkout itself', async () => {
    const { creatorInr } = await seedPlans();
    const a = await login('buyer');
    const co = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: creatorInr }).expect(201)).body;
    expect(co).toMatchObject({ provider: 'razorpay', keyId: RZP.keyId, subscriptionId: expect.stringMatching(/^sub_/) });
    expect(JSON.stringify(co)).not.toContain(RZP.keySecret);
    expect(calls.find((c) => c.url.endsWith('/v1/plans'))?.body).toMatchObject({ period: 'monthly', interval: 1, item: { amount: 99_900, currency: 'INR' } });
    expect((await overview(a.auth)).plan.code).toBe('free');
    expect((await http().get(`${V}/billing/checkouts/${co.checkoutId}`).set('Authorization', a.auth).expect(200)).body.status).toBe('created');

    const forged = rzpEvent('subscription.charged', charged(co.subscriptionId, 99_900, T0));
    await http().post(`${V}/webhooks/billing/razorpay`).set({ ...forged.headers, 'x-razorpay-signature': '0'.repeat(64) }).send(forged.raw).expect(400);
    expect((await overview(a.auth)).plan.code).toBe('free');

    const low = rzpEvent('subscription.charged', charged(co.subscriptionId, 100, T0));
    expect((await sendRzp(low)).outcome).toBe('amount_mismatch');

    const ok = rzpEvent('subscription.charged', charged(co.subscriptionId, 99_900, T0), 'evt_charge_1');
    expect(await sendRzp(ok)).toEqual({ received: true, outcome: 'subscription_charged' });
    expect(await sendRzp(ok)).toEqual({ received: true, duplicate: true });

    const o = await overview(a.auth);
    expect(o).toMatchObject({ plan: { code: 'creator', source: 'subscription' }, subscription: { status: 'active', provider: 'razorpay', amountMinor: 99_900 }, credits: { allowanceRemaining: 480 }, entitlements: { maxActiveProjects: 3 } });
    expect(o.invoices).toHaveLength(1);
    expect(o.invoices[0]).toMatchObject({ number: expect.stringMatching(/^MYA-\d{6}$/), totalMinor: 99_900, status: 'paid' });
    expect((await http().get(`${V}/billing/checkouts/${co.checkoutId}`).set('Authorization', a.auth)).body.status).toBe('completed');
    // The previous Free allowance expired rather than stacking.
    expect(await prisma.creditLedgerEntry.count({ where: { organizationId: a.orgId, reason: 'expiry' } })).toBe(1);
  });

  it('renews: a new period expires unused allowance, grants a fresh one, and keeps purchased credits', async () => {
    const { creatorInr, pack } = await seedPlans();
    const a = await login('renew');
    const co = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: creatorInr }).expect(201)).body;
    await sendRzp(rzpEvent('subscription.charged', charged(co.subscriptionId, 99_900, T0)));
    const top = (await http().post(`${V}/billing/checkout/topup`).set('Authorization', a.auth).send({ creditPackId: pack }).expect(201)).body;
    await sendRzp(rzpEvent('order.paid', { order: { entity: { id: top.orderId } }, payment: { entity: { id: 'pay_top1', amount: 49_900, currency: 'INR', order_id: top.orderId } } }));
    // Spend 200: comes out of allowance first.
    await prisma.$transaction((tx) => app.get(CreditsService).debit(tx, a.orgId, 200, `test:${randomUUID()}`, { type: 'test', id: '1' }));
    expect((await overview(a.auth)).credits).toMatchObject({ allowanceRemaining: 280, purchasedRemaining: 300 });

    await sendRzp(rzpEvent('subscription.charged', charged(co.subscriptionId, 99_900, T0 + 30 * 86400)));
    const o = await overview(a.auth);
    expect(o.credits).toMatchObject({ allowanceRemaining: 480, purchasedRemaining: 300, total: 780 });
    expect(o.invoices).toHaveLength(3);

    // Spending past the allowance draws on purchased credits.
    await prisma.$transaction((tx) => app.get(CreditsService).debit(tx, a.orgId, 500, `test:${randomUUID()}`, { type: 'test', id: '2' }));
    expect((await overview(a.auth)).credits).toMatchObject({ allowanceRemaining: 0, purchasedRemaining: 280 });
  });

  it('credits a top-up exactly once, only for the paid amount', async () => {
    const { pack } = await seedPlans();
    const a = await login('topup');
    const top = (await http().post(`${V}/billing/checkout/topup`).set('Authorization', a.auth).send({ creditPackId: pack }).expect(201)).body;
    expect(top).toMatchObject({ provider: 'razorpay', orderId: expect.stringMatching(/^order_/), amount: 49_900 });
    const wrong = rzpEvent('order.paid', { order: { entity: { id: top.orderId } }, payment: { entity: { id: 'pay_x', amount: 100, currency: 'INR', order_id: top.orderId } } });
    expect((await sendRzp(wrong)).outcome).toBe('amount_mismatch');
    const paid = { order: { entity: { id: top.orderId } }, payment: { entity: { id: 'pay_ok', amount: 49_900, currency: 'INR', order_id: top.orderId } } };
    expect((await sendRzp(rzpEvent('order.paid', paid))).outcome).toBe('topup_credited');
    expect((await sendRzp(rzpEvent('order.paid', paid))).outcome).toBe('already_processed');
    expect((await overview(a.auth)).credits).toMatchObject({ allowanceRemaining: 100, purchasedRemaining: 300 });
  });

  it('cancels at period end, then reverts to Free without deleting projects; over-limit workspaces become read-only for AI', async () => {
    const { creatorInr } = await seedPlans();
    const a = await login('cancel');
    const co = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: creatorInr }).expect(201)).body;
    await sendRzp(rzpEvent('subscription.charged', charged(co.subscriptionId, 99_900, T0)));
    for (const n of ['A', 'B']) await http().post(`${V}/projects`).set('Authorization', a.auth).send({ name: n, type: 'website' }).expect(201);

    const c = (await http().post(`${V}/billing/subscription/cancel`).set('Authorization', a.auth).send({}).expect(200)).body;
    expect(c.cancelAtPeriodEnd).toBe(true);
    expect(calls.find((x) => x.url.endsWith(`/subscriptions/${co.subscriptionId}/cancel`))?.body).toEqual({ cancel_at_cycle_end: 1 });
    expect((await overview(a.auth)).plan.code).toBe('creator');

    await sendRzp(rzpEvent('subscription.cancelled', { subscription: { entity: { id: co.subscriptionId, status: 'cancelled' } } }));
    const o = await overview(a.auth);
    expect(o).toMatchObject({ plan: { code: 'free' }, subscription: null, credits: { allowanceRemaining: 100 }, usage: { activeProjects: 2 } });
    const [p] = (await http().get(`${V}/projects`).set('Authorization', a.auth).expect(200)).body.items;
    const blocked = await http().post(`${V}/projects/${p.id}/generations`).set('Authorization', a.auth).send({ prompt: 'make it nicer' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('plan_limit_projects');
  });

  it('upgrading activates the new plan and stops billing the old subscription', async () => {
    const { creatorInr, proInr } = await seedPlans();
    const a = await login('upgrade');
    const c1 = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: creatorInr }).expect(201)).body;
    await sendRzp(rzpEvent('subscription.charged', charged(c1.subscriptionId, 99_900, T0)));
    await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: creatorInr }).expect(409);
    const c2 = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: proInr }).expect(201)).body;
    await sendRzp(rzpEvent('subscription.charged', charged(c2.subscriptionId, 249_900, T0 + 86400)));
    expect((await overview(a.auth))).toMatchObject({ plan: { code: 'pro' }, credits: { allowanceRemaining: 1200 }, entitlements: { maxActiveProjects: 10 } });
    expect(calls.find((x) => x.url.endsWith(`/subscriptions/${c1.subscriptionId}/cancel`))?.body).toEqual({ cancel_at_cycle_end: 0 });
  });

  it('only workspace owners can buy plans; outsiders cannot see checkouts', async () => {
    const { creatorInr } = await seedPlans();
    const owner = await login('own');
    const member = await login('mem');
    await prisma.organizationMembership.create({ data: { organizationId: owner.orgId, userId: member.id, role: 'admin' } });
    await http().post(`${V}/billing/checkout/subscription`).set('Authorization', member.auth).send({ planPriceId: creatorInr, organizationId: owner.orgId }).expect(403);
    const co = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', owner.auth).send({ planPriceId: creatorInr }).expect(201)).body;
    const outsider = await login('out');
    await http().get(`${V}/billing/checkouts/${co.checkoutId}`).set('Authorization', outsider.auth).expect(404);
  });
});

describe('subscriptions (Stripe)', () => {
  it('Checkout Session → linked subscription → invoice.paid activates the plan', async () => {
    const { proUsd } = await seedPlans();
    const a = await login('usd');
    const co = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: proUsd }).expect(201)).body;
    expect(co).toMatchObject({ provider: 'stripe', checkoutUrl: expect.stringContaining('checkout.stripe.com') });
    const sessionId = (await prisma.billingCheckout.findUniqueOrThrow({ where: { id: co.checkoutId } })).providerRef;
    const send = async (evt: object) => {
      const payload = JSON.stringify(evt);
      return (await http().post(`${V}/webhooks/billing/stripe`).set({ 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WHSEC }), 'content-type': 'application/json' }).send(payload).expect(200)).body;
    };
    expect((await send({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: { id: sessionId, object: 'checkout.session', mode: 'subscription', subscription: 'sub_stripe_1', customer: 'cus_1', payment_status: 'paid' } } })).outcome).toBe('checkout_linked');
    expect((await overview(a.auth)).plan.code).toBe('free');
    const inv = { id: 'in_1', object: 'invoice', amount_paid: 2900, currency: 'usd', customer: 'cus_1', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_stripe_1' } }, lines: { object: 'list', data: [{ period: { start: T0, end: T0 + 30 * 86400 } }] } };
    expect((await send({ id: 'evt_2', object: 'event', type: 'invoice.paid', data: { object: inv } })).outcome).toBe('subscription_charged');
    expect(await overview(a.auth)).toMatchObject({ plan: { code: 'pro' }, subscription: { provider: 'stripe', currency: 'USD' } });
  });
});

describe('owner administration', () => {
  it('hides the admin API from customers and bootstraps the owner from config', async () => {
    const customer = await login('cust');
    await http().get(`${V}/admin/overview`).set('Authorization', customer.auth).expect(404);
    const owner = await login('owner', OWNER_EMAIL);
    expect(owner.me.platformRole).toBe('superadmin');
    await http().get(`${V}/admin/overview`).set('Authorization', owner.auth).expect(200);
  });

  it('reports MRR, revenue, AI cost and margin from real records', async () => {
    const { creatorInr } = await seedPlans();
    const owner = await login('owner', OWNER_EMAIL);
    const a = await login('payer');
    const co = (await http().post(`${V}/billing/checkout/subscription`).set('Authorization', a.auth).send({ planPriceId: creatorInr }).expect(201)).body;
    await sendRzp(rzpEvent('subscription.charged', charged(co.subscriptionId, 99_900, T0)));
    await prisma.aiUsage.create({ data: { organizationId: a.orgId, provider: 'anthropic', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 1000, costMicros: 1_000_000n, creditsCharged: 100, latencyMs: 1, success: true } });
    const o = (await http().get(`${V}/admin/overview?days=30`).set('Authorization', owner.auth).expect(200)).body;
    expect(o.subscriptions).toMatchObject({ active: 1, byPlan: { creator: 1 } });
    expect(o.mrrMinor).toEqual({ INR: 99_900 });
    expect(o.arrMinor).toEqual({ INR: 1_198_800 });
    expect(o.revenue[0]).toMatchObject({ currency: 'INR', grossMinor: 99_900, feesMinor: 1998 });
    expect(o.ai.costUsd).toBe(1);
    expect(o.grossMarginInr).toEqual({ netRevenueMinor: 97_902, aiCostMinor: 8500, marginMinor: 89_402 });
    const users = (await http().get(`${V}/admin/users?q=payer`).set('Authorization', owner.auth).expect(200)).body;
    expect(users[0]).toMatchObject({ plan: 'creator', aiCostUsd: 1, revenue: [{ currency: 'INR', netMinor: 99_900 }] });
  });

  it('lets owners change plans without code changes; prices are immutable; every change is audited', async () => {
    await seedPlans();
    const owner = await login('owner', OWNER_EMAIL);
    const support = await login('support');
    await prisma.user.update({ where: { id: support.id }, data: { platformRole: 'support' } });
    const plans = (await http().get(`${V}/admin/plans`).set('Authorization', owner.auth).expect(200)).body;
    const creator = plans.find((p: { code: string }) => p.code === 'creator');
    await http().patch(`${V}/admin/plans/${creator.id}`).set('Authorization', support.auth).send({ includedCredits: 9999 }).expect(403);
    await http().patch(`${V}/admin/plans/${creator.id}`).set('Authorization', owner.auth).send({ includedCredits: 600, maxProjects: 5 }).expect(200);
    expect((await http().get(`${V}/billing/plans`).expect(200)).body.plans.find((p: { code: string }) => p.code === 'creator')).toMatchObject({ monthlyCredits: 600, maxActiveProjects: 5 });
    await http().post(`${V}/admin/plans/${creator.id}/prices`).set('Authorization', owner.auth).send({ interval: 'monthly', currency: 'INR', amountMinor: 129_900 }).expect(409);
    await http().post(`${V}/admin/plans/${creator.id}/prices`).set('Authorization', owner.auth).send({ interval: 'yearly', currency: 'INR', amountMinor: 999_000 }).expect(201);
    const free = plans.find((p: { code: string }) => p.code === 'free');
    await http().patch(`${V}/admin/plans/${free.id}`).set('Authorization', owner.auth).send({ active: false }).expect(400);
    const log = (await http().get(`${V}/admin/audit-log?limit=10`).set('Authorization', owner.auth).expect(200)).body.map((l: { action: string }) => l.action);
    expect(log).toEqual(expect.arrayContaining(['admin.plan_updated', 'admin.price_set']));
  });

  it('adjusts credits and suspends abusive accounts', async () => {
    const owner = await login('owner', OWNER_EMAIL);
    const a = await login('abuser');
    await http().post(`${V}/admin/organizations/${a.orgId}/credits`).set('Authorization', owner.auth).send({ amount: 50, bucket: 'purchased', reason: 'Goodwill credit', idempotencyKey: 'goodwill-1' }).expect(201);
    await http().post(`${V}/admin/organizations/${a.orgId}/credits`).set('Authorization', owner.auth).send({ amount: 50, bucket: 'purchased', reason: 'Goodwill credit', idempotencyKey: 'goodwill-1' }).expect(201);
    expect((await overview(a.auth)).credits.purchasedRemaining).toBe(50);
    await http().post(`${V}/admin/organizations/${a.orgId}/credits`).set('Authorization', owner.auth).send({ amount: -500, bucket: 'purchased', reason: 'Clawback', idempotencyKey: 'clawback-1' }).expect(400);
    await http().post(`${V}/admin/users/${a.id}/suspend`).set('Authorization', owner.auth).send({ reason: 'Phishing site generation' }).expect(201);
    await http().get(`${V}/me`).set('Authorization', a.auth).expect(403);
    await http().post(`${V}/admin/users/${a.id}/restore`).set('Authorization', owner.auth).send({ reason: 'Appeal accepted' }).expect(201);
    await http().get(`${V}/me`).set('Authorization', a.auth).expect(200);
    await http().post(`${V}/admin/users/${owner.id}/suspend`).set('Authorization', owner.auth).send({ reason: 'self' }).expect(400);
  });
});

describe('profile', () => {
  it('lets users update their profile', async () => {
    const a = await login('prof');
    const res = (await http().patch(`${V}/me`).set('Authorization', a.auth).send({ displayName: 'Rakshit' }).expect(200)).body;
    expect(res.displayName).toBe('Rakshit');
    await http().patch(`${V}/me`).set('Authorization', a.auth).send({ platformRole: 'superadmin' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).platformRole).toBe('user');
  });
});
