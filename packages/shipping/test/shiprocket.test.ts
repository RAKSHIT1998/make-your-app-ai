import { describe, expect, it } from 'vitest';
import { ShiprocketProvider, ShippingError, shiprocketState } from '../src/index.js';

type Call = { method: string; path: string; auth: string | null; body: any };
function stub(routes: (c: Call) => { status?: number; json: unknown } | undefined) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const c: Call = { method: init?.method ?? 'GET', path: u.pathname.replace('/v1/external', '') + u.search, auth: (init?.headers as Record<string, string>)?.authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = c.path === '/auth/login' ? (c.body.password === 'right' ? { json: { token: `tok-${calls.filter((x) => x.path === '/auth/login').length}` } } : { status: 401, json: { message: 'Invalid email and password combination' } }) : routes(c);
    return new Response(JSON.stringify(r?.json ?? {}), { status: r?.status ?? (r ? 200 : 404) });
  }) as typeof fetch;
  return { f, calls };
}
const creds = (email: string, password = 'right') => ({ provider: 'shiprocket' as const, email, password });
const REQ = { reference: 'MYA-1001', orderDate: new Date('2026-11-13T10:00:00Z'), pickupLocation: 'Primary', to: { name: 'Asha Rao Iyer', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', phone: '9876543210', email: 'asha@example.com' }, items: [{ name: 'Tea', sku: 'TEA-1', quantity: 2, unitPriceMinor: 25050 }], subtotalMinor: 50100, parcel: { weightGrams: 750, lengthCm: 20, breadthCm: 15, heightCm: 10 } };

describe('ShiprocketProvider', () => {
  it('signs in with the API user, reuses the token, and reports bad credentials without leaking them', async () => {
    const { f, calls } = stub(() => ({ json: { data: { available_courier_companies: [] } } }));
    const p = new ShiprocketProvider(creds('a1@x.in'), f);
    expect(await p.testConnection()).toEqual({ ok: true });
    await p.quote({ pickupPostcode: '110001', deliveryPostcode: '560001', weightGrams: 500, declaredValueMinor: 10000 });
    await p.quote({ pickupPostcode: '110001', deliveryPostcode: '560001', weightGrams: 500, declaredValueMinor: 10000 });
    expect(calls.filter((c) => c.path === '/auth/login')).toHaveLength(1);
    expect(calls.at(-1)!.auth).toBe('Bearer tok-1');

    const bad = await new ShiprocketProvider(creds('a2@x.in', 'wrong-secret'), f).testConnection();
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain('wrong-secret');
  });

  it('quotes couriers cheapest first in minor units, and treats "no courier" as an empty list', async () => {
    const { f, calls } = stub((c) => c.path.includes('delivery_postcode=560001') ? { json: { data: { available_courier_companies: [{ courier_company_id: 10, courier_name: 'Delhivery', rate: 82.5, estimated_delivery_days: '3' }, { courier_company_id: 54, courier_name: 'Ekart', rate: 61, estimated_delivery_days: '5' }] } } } : { status: 404, json: { message: 'No courier' } });
    const p = new ShiprocketProvider(creds('b@x.in'), f);
    expect(await p.quote({ pickupPostcode: '110001', deliveryPostcode: '560001', weightGrams: 750, declaredValueMinor: 50100 })).toEqual([{ courierId: '54', name: 'Ekart', rateMinor: 6100, etaDays: 5 }, { courierId: '10', name: 'Delhivery', rateMinor: 8250, etaDays: 3 }]);
    expect(calls.at(-1)!.path).toContain('weight=0.75');
    expect(calls.at(-1)!.path).toContain('cod=0');
    expect(await p.quote({ pickupPostcode: '110001', deliveryPostcode: '999999', weightGrams: 750, declaredValueMinor: 50100 })).toEqual([]);
  });

  it('creates a prepaid shipment in rupees and kilograms, then assigns a courier, schedules pickup and fetches the label', async () => {
    const { f, calls } = stub((c) => c.path === '/orders/create/adhoc' ? { json: { order_id: 771, shipment_id: 882, status: 'NEW' } }
      : c.path === '/courier/assign/awb' ? { json: { awb_assign_status: 1, response: { data: { awb_code: 'AWB123', courier_name: 'Ekart' } } } }
      : c.path === '/courier/generate/pickup' ? { json: { pickup_status: 1, response: { pickup_scheduled_date: '2026-11-14 10:00:00' } } }
      : c.path === '/courier/generate/label' ? { json: { label_created: 1, label_url: 'https://labels.example/l.pdf' } } : undefined);
    const p = new ShiprocketProvider(creds('c@x.in'), f);
    expect(await p.createShipment(REQ)).toEqual({ providerOrderId: '771', providerShipmentId: '882' });
    const sent = calls.find((c) => c.path === '/orders/create/adhoc')!.body;
    expect(sent).toMatchObject({ order_id: 'MYA-1001', order_date: '2026-11-13 15:30', pickup_location: 'Primary', billing_customer_name: 'Asha', billing_last_name: 'Rao Iyer', billing_pincode: '560001', payment_method: 'Prepaid', sub_total: 501, weight: 0.75, shipping_is_billing: true });
    expect(sent.order_items).toEqual([{ name: 'Tea', sku: 'TEA-1', units: 2, selling_price: 250.5 }]);
    expect(await p.assignCourier('882', '54')).toEqual({ awb: 'AWB123', courierName: 'Ekart' });
    expect(calls.at(-1)!.body).toEqual({ shipment_id: '882', courier_id: '54' });
    expect(await p.requestPickup('882')).toEqual({ scheduledFor: '2026-11-14 10:00:00' });
    expect(await p.label('882')).toEqual({ url: 'https://labels.example/l.pdf' });
  });

  it('surfaces provider reasons (validation, wallet balance) as typed errors', async () => {
    const { f } = stub((c) => c.path === '/orders/create/adhoc' ? { status: 422, json: { message: 'Oops! Invalid Data.', errors: { billing_phone: ['The billing phone must be 10 digits.'] } } }
      : c.path === '/courier/assign/awb' ? { json: { awb_assign_status: 0, response: { data: { awb_assign_error: 'Please recharge your wallet' } } } } : undefined);
    const p = new ShiprocketProvider(creds('d@x.in'), f);
    await expect(p.createShipment(REQ)).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('billing phone must be 10 digits') });
    const e = await p.assignCourier('882').catch((x) => x);
    expect(e).toBeInstanceOf(ShippingError);
    expect(e.message).toContain('recharge your wallet');
  });

  it('signs in again when the token has expired', async () => {
    let first = true;
    const { f, calls } = stub((c) => { if (c.path === '/orders/cancel' && first) { first = false; return { status: 401, json: { message: 'Token has expired' } }; } return { json: {} }; });
    await new ShiprocketProvider(creds('e@x.in'), f).cancel('771');
    expect(calls.map((c) => c.path)).toEqual(['/auth/login', '/orders/cancel', '/auth/login', '/orders/cancel']);
    expect(calls.at(-1)!.auth).toBe('Bearer tok-2');
    expect(calls.at(-1)!.body).toEqual({ ids: [771] });
  });

  it('normalises tracking', async () => {
    const { f } = stub(() => ({ json: { tracking_data: { track_url: 'https://shiprocket.co/tracking/AWB123', shipment_track: [{ current_status: 'Out For Delivery', edd: '2026-11-16 18:00:00' }], shipment_track_activities: [{ date: '2026-11-15 09:10:00', activity: 'Out for delivery', location: 'Bengaluru' }, { date: '2026-11-14 11:00:00', activity: 'Picked up', location: 'Delhi' }] } } }));
    const t = await new ShiprocketProvider(creds('f@x.in'), f).track('AWB123');
    expect(t).toMatchObject({ state: 'out_for_delivery', providerStatus: 'Out For Delivery', trackingUrl: 'https://shiprocket.co/tracking/AWB123', estimatedDelivery: '2026-11-16 18:00:00' });
    expect(t.events).toHaveLength(2);
    expect([shiprocketState('Delivered'), shiprocketState('RTO Initiated'), shiprocketState('Undelivered'), shiprocketState('Pickup Scheduled'), shiprocketState('AWB Assigned'), shiprocketState('In Transit'), shiprocketState('Canceled')]).toEqual(['delivered', 'returned', 'exception', 'pickup_scheduled', 'awb_assigned', 'in_transit', 'cancelled']);
  });
});
