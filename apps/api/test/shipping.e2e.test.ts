import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { RazorpayGateway, type GatewayCredentials } from '@mya/payments';
import { ShiprocketProvider, type ShippingCredentials } from '@mya/shipping';
import { GATEWAY_FACTORY } from '../src/commerce/gateways.js';
import { SHIPPING_FACTORY } from '../src/commerce/shipping.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

/**
 * The real Shiprocket adapter (real request building and response parsing) against an in-process emulation of
 * Shiprocket's HTTP API. It has not been run against Shiprocket's live service.
 */
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
const sr = { calls: [] as { path: string; body: any; auth: string }[], wallet: true, seq: 500, down: false, status: 'Pickup Scheduled' };
let rzpSeq = 0;
const emu = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  if (u.host === 'api.razorpay.com') {
    if (u.pathname.endsWith('/orders') && init?.method === 'POST') return Response.json({ id: `order_S${++rzpSeq}`, amount: body.amount, currency: body.currency, status: 'created' });
    return Response.json({ items: [] });
  }
  const path = u.pathname.replace('/v1/external', '');
  sr.calls.push({ path: path + u.search, body, auth });
  if (sr.down) return new Response('upstream error', { status: 503 });
  if (path === '/auth/login') return body.email === 'api@kashmir.example' && body.password === 'sr-api-password' ? Response.json({ token: 'sr-token' }) : new Response(JSON.stringify({ message: 'Invalid email and password combination' }), { status: 401 });
  if (auth !== 'Bearer sr-token') return new Response(JSON.stringify({ message: 'Unauthenticated' }), { status: 401 });
  if (path === '/courier/serviceability/') return u.searchParams.get('delivery_postcode') === '190001' ? Response.json({ data: { available_courier_companies: [{ courier_company_id: 10, courier_name: 'Delhivery Surface', rate: 96, estimated_delivery_days: '4' }, { courier_company_id: 33, courier_name: 'Blue Dart', rate: 148.5, estimated_delivery_days: '2' }] } }) : new Response(JSON.stringify({ message: 'No courier serviceable' }), { status: 404 });
  if (path === '/orders/create/adhoc') return Response.json({ order_id: ++sr.seq, shipment_id: ++sr.seq, status: 'NEW' });
  if (path === '/courier/assign/awb') return sr.wallet ? Response.json({ awb_assign_status: 1, response: { data: { awb_code: `AWB${body.shipment_id}`, courier_name: body.courier_id === '33' ? 'Blue Dart' : 'Delhivery Surface' } } }) : Response.json({ awb_assign_status: 0, response: { data: { awb_assign_error: 'Insufficient wallet balance. Please recharge your wallet.' } } });
  if (path === '/courier/generate/pickup') return Response.json({ pickup_status: 1, response: { pickup_scheduled_date: '2026-11-14 11:00:00' } });
  if (path === '/courier/generate/label') return Response.json({ label_created: 1, label_url: 'https://labels.shiprocket.example/label.pdf' });
  if (path.startsWith('/courier/track/awb/')) return Response.json({ tracking_data: { track_url: `https://shiprocket.co/tracking/${path.split('/').pop()}`, shipment_track: [{ current_status: sr.status, edd: '2026-11-17 18:00:00' }], shipment_track_activities: [{ date: '2026-11-14 12:00:00', activity: sr.status, location: 'Srinagar' }] } });
  if (path === '/orders/cancel') return Response.json({ status_code: 200 });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const RZP = { provider: 'razorpay', keyId: 'rzp_test_good', keySecret: 'rzp_key_secret_value', webhookSecret: 'rzp_webhook_secret' } as const;
const SR = { email: 'api@kashmir.example', password: 'sr-api-password', pickupLocation: 'Warehouse', pickupPostcode: '110001', parcel: { weightGrams: 500, lengthCm: 20, breadthCm: 15, heightCm: 10 } };

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());
const V = '/api/v1';

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ env: { ENCRYPTION_KEY, PLATFORM_OWNER_EMAILS: 'boss@platform.example', RATE_LIMIT_PER_MINUTE: '100000', DEPLOY_RATE_LIMIT_PER_MINUTE: '100000', CHECKOUT_RATE_LIMIT_PER_MINUTE: '100000' }, overrides: [
    { provide: GATEWAY_FACTORY, useValue: (c: GatewayCredentials) => new RazorpayGateway(c as Extract<GatewayCredentials, { provider: 'razorpay' }>, emu) },
    { provide: SHIPPING_FACTORY, useValue: (c: ShippingCredentials) => new ShiprocketProvider(c, emu) },
  ] }));
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { sr.calls.length = 0; sr.wallet = true; sr.down = false; sr.status = 'Pickup Scheduled'; await resetDb(prisma); });

async function login(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { ...u, auth, orgId: me.body.personalOrgId as string };
}
const address = { name: 'Asha Bhat', line1: '12 Boulevard Rd', city: 'Srinagar', state: 'Jammu and Kashmir', postalCode: '190001', country: 'IN', phone: '+91 98765 43210' };
async function paidOrder(addr: Record<string, unknown> = address) {
  const owner = await login('owner');
  const store = (await http().post(`${V}/stores`).set('Authorization', owner.auth).send({ name: 'Kashmir Dry Fruits', currency: 'INR' }).expect(201)).body;
  const product = (await http().post(`${V}/stores/${store.id}/products`).set('Authorization', owner.auth).send({ title: 'Premium Walnuts', status: 'active', variants: [{ title: '500 g', sku: 'WAL-500', priceMinor: 59900, weightGrams: 550, inventory: { onHand: 9 } }] }).expect(201)).body;
  await http().put(`${V}/stores/${store.id}/payments`).set('Authorization', owner.auth).send(RZP).expect(200);
  await http().patch(`${V}/stores/${store.id}`).set('Authorization', owner.auth).send({ status: 'active' }).expect(200);
  const order = (await http().post(`${V}/storefront/${store.slug}/checkout`).send({ checkoutToken: randomUUID() + randomUUID(), email: 'buyer@example.com', shippingAddress: addr, items: [{ variantId: product.variants[0].id, quantity: 2 }] }).expect(201)).body;
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: order.payment.razorpayOrderId, amount: order.totalMinor, currency: 'INR', status: 'captured' } } } });
  await http().post(`${V}/webhooks/payments/razorpay/${store.id}`).set({ 'x-razorpay-signature': createHmac('sha256', RZP.webhookSecret).update(raw).digest('hex'), 'x-razorpay-event-id': `evt_${randomUUID()}`, 'content-type': 'application/json' }).send(raw).expect(200);
  const base = `${V}/stores/${store.id}`;
  return { owner, store, order, base, o: `${base}/orders/${order.id}` };
}

describe('extensions catalogue and Shiprocket connection', () => {
  it('lists real extensions with their status; connecting verifies the login, stores it encrypted and never returns it', async () => {
    const { owner, base, store } = await paidOrder();
    let list = (await http().get(`${base}/extensions`).set('Authorization', owner.auth).expect(200)).body;
    expect(list.map((e: { key: string; status: string }) => [e.key, e.status])).toEqual([['razorpay', 'connected'], ['stripe', 'available'], ['shiprocket', 'available']]);

    const bad = await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send({ ...SR, password: 'wrong-pass-123' }).expect(422);
    expect(bad.body.message).toMatch(/did not accept/);
    expect(JSON.stringify(bad.body)).not.toContain('wrong-pass-123');
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send({ ...SR, pickupPostcode: '12' }).expect(400);

    list = (await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send(SR).expect(200)).body;
    const ext = list.find((e: { key: string }) => e.key === 'shiprocket');
    expect(ext).toMatchObject({ status: 'connected', settings: { email: SR.email, pickupLocation: 'Warehouse', pickupPostcode: '110001' } });
    expect(JSON.stringify(list)).not.toContain(SR.password);
    const integ = await prisma.integration.findFirstOrThrow({ where: { provider: 'shiprocket' } });
    expect(integ.encryptedCreds).not.toContain(SR.password);
    expect(JSON.stringify((await http().get(`${V}/stores/${store.id}`).set('Authorization', owner.auth)).body)).not.toContain(SR.password);
    expect(await prisma.auditLog.count({ where: { action: 'store.extension_connected' } })).toBe(1);

    // Settings can change without re-entering the password; disconnect removes the stored login.
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send({ ...SR, password: undefined, pickupLocation: 'Shop' }).expect(200);
    list = (await http().delete(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).expect(200)).body;
    expect(list.find((e: { key: string }) => e.key === 'shiprocket').status).toBe('available');
    expect(await prisma.integration.count({ where: { provider: 'shiprocket' } })).toBe(0);
  });

  it('is admin-only to connect and invisible to other workspaces', async () => {
    const { owner, base, o } = await paidOrder();
    const member = await login('member');
    const stranger = await login('stranger');
    await prisma.organizationMembership.create({ data: { organizationId: owner.orgId, userId: member.id, role: 'member' } });
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', member.auth).send(SR).expect(403);
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send(SR).expect(200);
    await http().get(`${base}/extensions`).set('Authorization', stranger.auth).expect(404);
    await http().get(`${o}/shipping/rates`).set('Authorization', stranger.auth).expect(404);
    await http().post(`${o}/shipment`).set('Authorization', stranger.auth).send({}).expect(404);
    await http().get(`${o}/shipment`).set('Authorization', stranger.auth).expect(404);
    expect(sr.calls.filter((c) => c.path.startsWith('/orders'))).toHaveLength(0);
  });
});

describe('shipping an order', () => {
  it('quotes couriers, books the chosen one, marks the order fulfilled with its AWB, then tracks, labels and cancels', async () => {
    const { owner, base, o, store, order } = await paidOrder();
    await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({}).expect(409); // not connected yet
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send(SR).expect(200);

    const rates = (await http().get(`${o}/shipping/rates`).set('Authorization', owner.auth).expect(200)).body;
    expect(rates.weightGrams).toBe(1100); // 2 × 550 g from the variants
    expect(rates.couriers).toEqual([{ courierId: '10', name: 'Delhivery Surface', rateMinor: 9600, etaDays: 4 }, { courierId: '33', name: 'Blue Dart', rateMinor: 14850, etaDays: 2 }]);

    const s = (await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({ courierId: '33' }).expect(200)).body;
    expect(s).toMatchObject({ provider: 'shiprocket', state: 'pickup_scheduled', courierName: 'Blue Dart', pickupScheduledFor: '2026-11-14 11:00:00', lastError: null });
    expect(s.awb).toMatch(/^AWB/);
    const sent = sr.calls.find((c) => c.path === '/orders/create/adhoc')!.body;
    expect(sent).toMatchObject({ order_id: `${store.slug}-${order.number}`, pickup_location: 'Warehouse', billing_phone: '9876543210', billing_pincode: '190001', billing_state: 'Jammu and Kashmir', payment_method: 'Prepaid', sub_total: 1198, weight: 1.1, billing_email: 'buyer@example.com' });
    expect(sent.order_items).toEqual([{ name: 'Premium Walnuts (500 g)', sku: 'WAL-500', units: 2, selling_price: 599 }]);

    const after = (await http().get(o).set('Authorization', owner.auth).expect(200)).body;
    expect(after).toMatchObject({ fulfillmentStatus: 'fulfilled', trackingNumber: s.awb, shippingMethod: 'Blue Dart' });
    // Booking twice never creates a second shipment.
    await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({}).expect(409);
    expect(sr.calls.filter((c) => c.path === '/orders/create/adhoc')).toHaveLength(1);

    sr.status = 'Out For Delivery';
    const t = (await http().post(`${o}/shipment/sync`).set('Authorization', owner.auth).expect(200)).body;
    expect(t).toMatchObject({ state: 'out_for_delivery', providerStatus: 'Out For Delivery', trackingUrl: `https://shiprocket.co/tracking/${s.awb}` });
    expect(t.events[0]).toMatchObject({ text: 'Out For Delivery', location: 'Srinagar' });
    expect((await http().get(`${o}/shipment/label`).set('Authorization', owner.auth).expect(200)).body).toEqual({ url: 'https://labels.shiprocket.example/label.pdf' });
    await http().post(`${o}/shipment/cancel`).set('Authorization', owner.auth).expect(409); // already with the courier
    expect(await prisma.auditLog.count({ where: { action: 'order.shipment_booked' } })).toBe(1);
  });

  it('resumes after a provider failure instead of duplicating, and cancel reopens the order for a fresh booking', async () => {
    const { owner, base, o, store, order } = await paidOrder();
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send(SR).expect(200);

    sr.wallet = false;
    const fail = await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({}).expect(422);
    expect(fail.body.message).toMatch(/recharge your wallet/);
    let s = (await http().get(`${o}/shipment`).set('Authorization', owner.auth).expect(200)).body;
    expect(s).toMatchObject({ state: 'created', awb: null, lastError: expect.stringMatching(/wallet/) });
    expect((await http().get(o).set('Authorization', owner.auth)).body.fulfillmentStatus).toBe('unfulfilled');

    sr.wallet = true;
    s = (await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({}).expect(200)).body;
    expect(s).toMatchObject({ state: 'pickup_scheduled', lastError: null });
    expect(sr.calls.filter((c) => c.path === '/orders/create/adhoc')).toHaveLength(1); // resumed, not recreated

    s = (await http().post(`${o}/shipment/cancel`).set('Authorization', owner.auth).expect(200)).body;
    expect(s.state).toBe('cancelled');
    expect((await http().get(o).set('Authorization', owner.auth)).body).toMatchObject({ fulfillmentStatus: 'unfulfilled', trackingNumber: null });
    s = (await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({}).expect(200)).body;
    expect(s.state).toBe('pickup_scheduled');
    expect(sr.calls.filter((c) => c.path === '/orders/create/adhoc').at(-1)!.body.order_id).toBe(`${store.slug}-${order.number}-r2`);
  });

  it('explains what is missing instead of sending a bad address, and reports an outage without leaving the order stuck', async () => {
    const { owner, base, o } = await paidOrder({ name: 'Asha Bhat', line1: '12 Boulevard Rd', city: 'Srinagar', postalCode: '190001', country: 'IN' });
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send(SR).expect(200);
    const res = await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({}).expect(422);
    expect(res.body.message).toBe('The delivery address is missing: state, 10-digit mobile number.');
    expect(sr.calls.filter((c) => c.path === '/orders/create/adhoc')).toHaveLength(0);

    const ok = await paidOrder();
    await http().put(`${ok.base}/extensions/shiprocket`).set('Authorization', ok.owner.auth).send(SR).expect(200);
    sr.down = true;
    await http().post(`${ok.o}/shipment`).set('Authorization', ok.owner.auth).send({}).expect(503);
    sr.down = false;
    expect((await http().post(`${ok.o}/shipment`).set('Authorization', ok.owner.auth).send({}).expect(200)).body.state).toBe('pickup_scheduled');
  });
});

describe('owner analytics', () => {
  it('reports real trends, customer-store sales, shipments and extension adoption to the platform owner only', async () => {
    const { owner, base, o, order } = await paidOrder();
    await http().put(`${base}/extensions/shiprocket`).set('Authorization', owner.auth).send(SR).expect(200);
    await http().post(`${o}/shipment`).set('Authorization', owner.auth).send({}).expect(200);
    await http().get(`${V}/admin/analytics`).set('Authorization', owner.auth).expect(404); // a customer, not the platform owner

    const bossId = randomUUID();
    const boss = `Bearer ${await tokenFor(bossId, 'boss@platform.example')}`;
    await http().get(`${V}/me`).set('Authorization', boss).expect(200);
    const a = (await http().get(`${V}/admin/analytics?days=7`).set('Authorization', boss).expect(200)).body;
    expect(a.series.signups).toHaveLength(7);
    expect(a.series.signups.at(-1).value).toBe(2); // the merchant and the owner, both today
    expect(a.series.signups.slice(0, 6).every((d: { value: number }) => d.value === 0)).toBe(true);
    expect(a.customerStores.sales).toEqual([{ currency: 'INR', grossMinor: order.totalMinor, refundedMinor: 0, orders: 1 }]);
    expect(a.customerStores.byStatus).toEqual({ active: 1 });
    expect(a.customerStores.shipments).toEqual({ pickup_scheduled: 1 });
    expect(a.extensions).toEqual(expect.arrayContaining([{ provider: 'razorpay', workspaces: 1 }, { provider: 'shiprocket', workspaces: 1 }]));
    expect(a.revenue).toEqual([]); // no platform invoices: store sales are never counted as platform revenue
    expect(JSON.stringify(a)).not.toContain(SR.password);
  });
});
