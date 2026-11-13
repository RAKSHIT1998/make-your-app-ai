import { ShippingError, type CourierQuote, type ShipmentRequest, type ShipmentState, type ShippingProvider, type ShiprocketCredentials, type Tracking } from './types.js';

type Fetch = typeof fetch;
const BASE = 'https://apiv2.shiprocket.in/v1/external';
/** Shiprocket tokens last at least a day; we re-login well before that and on any 401. */
const TOKEN_TTL_MS = 12 * 3600_000;
const tokens = new Map<string, { token: string; at: number }>();

const rupees = (minor: number) => Math.round(minor) / 100;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Maps Shiprocket's status wording to our states. Unknown wording stays `in_transit` once a courier has the parcel. */
export function shiprocketState(status: string): ShipmentState {
  const s = status.toLowerCase();
  if (/cancel/.test(s)) return 'cancelled';
  if (/rto|return/.test(s)) return 'returned';
  if (/out for delivery/.test(s)) return 'out_for_delivery';
  if (/undelivered|lost|damaged|destroyed|exception|failed/.test(s)) return 'exception';
  if (/delivered/.test(s)) return 'delivered';
  if (/pickup (scheduled|generated|queued)|out for pickup|pickup rescheduled/.test(s)) return 'pickup_scheduled';
  if (/awb assigned|label generated|ready to ship|manifest/.test(s)) return 'awb_assigned';
  if (/new|pending/.test(s)) return 'created';
  return 'in_transit';
}

/**
 * Shiprocket (India). Uses the merchant's own API user; nothing is shipped on the platform's account.
 * Docs: https://apidocs.shiprocket.in
 */
export class ShiprocketProvider implements ShippingProvider {
  readonly name = 'shiprocket';
  constructor(private readonly creds: ShiprocketCredentials, private readonly fetchImpl: Fetch = fetch, private readonly base = BASE) {}

  private async login(force = false): Promise<string> {
    const key = `${this.base}|${this.creds.email}`;
    const hit = tokens.get(key);
    if (!force && hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
    const res = await this.raw('POST', '/auth/login', { email: this.creds.email, password: this.creds.password }, null);
    const token = str((res.body as { token?: unknown }).token);
    if (!res.ok || !token) throw new ShippingError(res.status === 401 || res.status === 403 || res.status === 400 ? 'Shiprocket did not accept that API user email and password.' : `Shiprocket sign-in failed (${res.status}).`, res.status >= 500 ? 'unavailable' : 'auth', res.status);
    tokens.set(key, { token, at: Date.now() });
    return token;
  }

  private async raw(method: string, path: string, body: unknown, token: string | null) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ShippingError('Could not reach Shiprocket. Try again in a moment.', 'unavailable');
    }
    const text = await res.text();
    let json: unknown = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, body: json as Record<string, unknown> };
  }

  /** Never includes credentials or tokens in the message. */
  private fail(res: { status: number; body: Record<string, unknown> }, what: string): never {
    const b = res.body;
    const errors = b.errors && typeof b.errors === 'object' ? Object.values(b.errors as Record<string, unknown>).flat().map(str).join(' ') : '';
    const detail = (errors || str(b.message) || str((b.response as { data?: { awb_assign_error?: unknown } } | undefined)?.data?.awb_assign_error)).slice(0, 300);
    const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'unavailable' : res.status < 300 || res.status === 422 || res.status === 400 || res.status === 404 ? 'invalid' : 'provider';
    throw new ShippingError(`${what}${detail ? `: ${detail}` : ` (Shiprocket ${res.status})`}`, kind, res.status);
  }

  private async call(method: string, path: string, body?: unknown) {
    let res = await this.raw(method, path, body, await this.login());
    if (res.status === 401) res = await this.raw(method, path, body, await this.login(true));
    return res;
  }

  async testConnection() {
    try {
      await this.login(true);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async quote(q: { pickupPostcode: string; deliveryPostcode: string; weightGrams: number; declaredValueMinor: number }): Promise<CourierQuote[]> {
    const qs = new URLSearchParams({ pickup_postcode: q.pickupPostcode, delivery_postcode: q.deliveryPostcode, weight: String(Math.max(0.05, q.weightGrams / 1000)), cod: '0', declared_value: String(rupees(q.declaredValueMinor)) });
    const res = await this.call('GET', `/courier/serviceability/?${qs}`);
    if (res.status === 404) return []; // Shiprocket answers 404 when no courier serves the route
    if (!res.ok) this.fail(res, 'Could not get delivery rates');
    const list = ((res.body.data as { available_courier_companies?: unknown } | undefined)?.available_courier_companies ?? []) as Record<string, unknown>[];
    return list
      .map((c) => ({ courierId: str(c.courier_company_id), name: str(c.courier_name), rateMinor: Math.round(Number(c.rate ?? c.freight_charge ?? NaN) * 100), etaDays: Number.isFinite(Number(c.estimated_delivery_days)) ? Number(c.estimated_delivery_days) : null }))
      .filter((c) => c.courierId && c.name && Number.isFinite(c.rateMinor))
      .sort((a, b) => a.rateMinor - b.rateMinor);
  }

  async createShipment(req: ShipmentRequest) {
    const [first, ...rest] = req.to.name.trim().split(/\s+/);
    const d = req.orderDate;
    const ist = new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
    const res = await this.call('POST', '/orders/create/adhoc', {
      order_id: req.reference,
      order_date: ist,
      pickup_location: req.pickupLocation,
      billing_customer_name: first ?? req.to.name,
      billing_last_name: rest.join(' '),
      billing_address: req.to.line1,
      billing_address_2: req.to.line2 ?? '',
      billing_city: req.to.city,
      billing_pincode: req.to.postalCode,
      billing_state: req.to.state,
      billing_country: 'India',
      billing_email: req.to.email,
      billing_phone: req.to.phone,
      shipping_is_billing: true,
      order_items: req.items.map((i) => ({ name: i.name.slice(0, 190), sku: i.sku, units: i.quantity, selling_price: rupees(i.unitPriceMinor) })),
      payment_method: 'Prepaid',
      sub_total: rupees(req.subtotalMinor),
      length: req.parcel.lengthCm,
      breadth: req.parcel.breadthCm,
      height: req.parcel.heightCm,
      weight: req.parcel.weightGrams / 1000,
    });
    const providerOrderId = str(res.body.order_id), providerShipmentId = str(res.body.shipment_id);
    if (!res.ok || !providerOrderId || !providerShipmentId) this.fail(res, 'Shiprocket did not create the shipment');
    return { providerOrderId, providerShipmentId };
  }

  async assignCourier(providerShipmentId: string, courierId?: string) {
    const res = await this.call('POST', '/courier/assign/awb', { shipment_id: providerShipmentId, ...(courierId ? { courier_id: courierId } : {}) });
    const data = (res.body.response as { data?: Record<string, unknown> } | undefined)?.data ?? {};
    const awb = str(data.awb_code);
    if (!res.ok || !awb) this.fail(res, 'Shiprocket could not assign a courier');
    return { awb, courierName: str(data.courier_name) || 'Courier' };
  }

  async requestPickup(providerShipmentId: string) {
    const res = await this.call('POST', '/courier/generate/pickup', { shipment_id: [providerShipmentId] });
    if (!res.ok) this.fail(res, 'Shiprocket could not schedule the pickup');
    const r = (res.body.response ?? {}) as Record<string, unknown>;
    return { scheduledFor: str(r.pickup_scheduled_date) || null };
  }

  async label(providerShipmentId: string) {
    const res = await this.call('POST', '/courier/generate/label', { shipment_id: [providerShipmentId] });
    const url = str(res.body.label_url);
    if (!res.ok || !/^https:\/\//.test(url)) this.fail(res, 'Shiprocket has no label for this shipment yet');
    return { url };
  }

  async track(awb: string): Promise<Tracking> {
    const res = await this.call('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
    if (!res.ok) this.fail(res, 'Could not get tracking');
    const t = (res.body.tracking_data ?? {}) as Record<string, unknown>;
    const head = ((t.shipment_track as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
    const acts = ((t.shipment_track_activities as Record<string, unknown>[] | null | undefined) ?? []);
    const providerStatus = str(head.current_status) || str(acts[0]?.activity) || 'Awaiting pickup';
    const url = str(t.track_url);
    return {
      state: shiprocketState(providerStatus),
      providerStatus,
      trackingUrl: /^https:\/\//.test(url) ? url : null,
      estimatedDelivery: str(head.edd) || str(t.etd) || null,
      events: acts.slice(0, 50).map((a) => ({ at: str(a.date), text: str(a.activity) || str(a['sr-status-label']), location: str(a.location) || null })),
    };
  }

  async cancel(providerOrderId: string) {
    const res = await this.call('POST', '/orders/cancel', { ids: [Number.isFinite(Number(providerOrderId)) ? Number(providerOrderId) : providerOrderId] });
    if (!res.ok) this.fail(res, 'Shiprocket could not cancel the shipment');
  }
}
