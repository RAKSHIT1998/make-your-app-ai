import { BadGatewayException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type PrismaClient, type Shipment, type Store } from '@mya/db';
import { ParcelSchema, type BookShipmentSchema, type ConnectShiprocketSchema, type ParcelInput } from '@mya/shared';
import { ShippingError, defaultShippingFactory, type ShippingCredentials, type ShippingFactory, type ShippingProvider } from '@mya/shipping';
import type { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { decryptJson, encryptJson } from '../common/crypto.js';
import type { AuthUser } from '../auth/auth.types.js';
import { GatewayRegistry } from './gateways.js';
import { MerchantService } from './merchant.service.js';

export const SHIPPING_FACTORY = Symbol('SHIPPING_FACTORY');
export const shippingFactoryProvider = { provide: SHIPPING_FACTORY, useValue: defaultShippingFactory };

interface ShippingSettings { pickupLocation: string; pickupPostcode: string; parcel: ParcelInput; accountEmail: string }
const BOOKING_LOCK_MS = 90_000;

/** What the store catalogue offers. Only extensions with a real, tested adapter are listed. */
const CATALOG = [
  { key: 'razorpay', category: 'payments', name: 'Razorpay', summary: 'Accept UPI, cards, netbanking and wallets. Money goes straight to your Razorpay account.', needs: ['Key ID', 'Key secret', 'Webhook secret'], site: 'https://razorpay.com' },
  { key: 'stripe', category: 'payments', name: 'Stripe', summary: 'Accept international cards. Money goes straight to your Stripe account.', needs: ['Secret key', 'Webhook signing secret'], site: 'https://stripe.com' },
  { key: 'shiprocket', category: 'delivery', name: 'Shiprocket', summary: 'Compare courier rates, book pickups, print labels and track parcels across India from the order page.', needs: ['API user email', 'API user password', 'Pickup location name'], site: 'https://www.shiprocket.in' },
] as const;

/**
 * Delivery extensions for stores. The merchant's own provider account is used; credentials are stored encrypted,
 * never returned, and never logged. Booking is a resumable sequence (create → courier → pickup) recorded on Shipment.
 */
@Injectable()
export class ShippingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MerchantService) private readonly merchant: MerchantService,
    @Inject(GatewayRegistry) private readonly gateways: GatewayRegistry,
    @Inject(SHIPPING_FACTORY) private readonly factory: ShippingFactory,
  ) {}

  private key(): string {
    if (!this.config.ENCRYPTION_KEY) throw new HttpException({ message: 'Extension setup required: the server has no ENCRYPTION_KEY configured.', setupRequired: true }, HttpStatus.SERVICE_UNAVAILABLE);
    return this.config.ENCRYPTION_KEY;
  }

  private settings(store: Pick<Store, 'shippingSettings'>): ShippingSettings | null {
    const s = store.shippingSettings as Partial<ShippingSettings> | null;
    return s && s.pickupLocation && s.pickupPostcode && ParcelSchema.safeParse(s.parcel).success ? (s as ShippingSettings) : null;
  }

  private async provider(store: Store): Promise<{ provider: ShippingProvider; settings: ShippingSettings }> {
    const settings = this.settings(store);
    const integ = store.shippingProvider ? await this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: store.organizationId, provider: store.shippingProvider } } }) : null;
    if (!settings || !integ?.encryptedCreds || integ.status !== 'connected') throw new ConflictException({ message: 'Connect a delivery extension first (Extensions → Shiprocket).', code: 'shipping_not_connected' });
    return { provider: this.factory(decryptJson<ShippingCredentials>(this.key(), integ.encryptedCreds)), settings };
  }

  private rethrow(e: unknown): never {
    if (!(e instanceof ShippingError)) throw e;
    if (e.kind === 'auth') throw new UnprocessableEntityException({ message: `${e.message} Reconnect it in Extensions.`, code: 'shipping_auth' });
    if (e.kind === 'unavailable') throw new HttpException({ message: e.message, code: 'shipping_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    if (e.kind === 'invalid') throw new UnprocessableEntityException({ message: e.message, code: 'shipping_rejected' });
    throw new BadGatewayException({ message: e.message, code: 'shipping_provider_error' });
  }

  // ───────── Catalogue and connection ─────────

  async extensions(user: AuthUser, storeId: string) {
    const store = await this.merchant.authorize(user, storeId, 'viewer');
    const pay = await this.gateways.status(store);
    const integs = await this.prisma.integration.findMany({ where: { organizationId: store.organizationId, provider: { in: CATALOG.map((c) => c.key) } }, select: { provider: true, status: true, lastTestedAt: true } });
    const s = this.settings(store);
    return CATALOG.map((c) => {
      const integ = integs.find((i) => i.provider === c.key);
      const active = c.category === 'payments' ? pay.provider === c.key && pay.status === 'connected' : store.shippingProvider === c.key && integ?.status === 'connected' && !!s;
      return {
        ...c,
        status: active ? ('connected' as const) : ('available' as const),
        lastTestedAt: active ? (integ?.lastTestedAt?.toISOString() ?? null) : null,
        settings: c.key === 'shiprocket' && active && s ? { email: s.accountEmail, pickupLocation: s.pickupLocation, pickupPostcode: s.pickupPostcode, parcel: s.parcel } : null,
      };
    });
  }

  async connectShiprocket(user: AuthUser, storeId: string, input: z.infer<typeof ConnectShiprocketSchema>) {
    const store = await this.merchant.authorize(user, storeId, 'admin');
    const where = { organizationId_provider: { organizationId: store.organizationId, provider: 'shiprocket' } };
    const existing = await this.prisma.integration.findUnique({ where });
    let creds: ShippingCredentials;
    if (input.password) creds = { provider: 'shiprocket', email: input.email, password: input.password };
    else {
      const saved = existing?.encryptedCreds ? decryptJson<ShippingCredentials>(this.key(), existing.encryptedCreds) : null;
      if (!saved || saved.email !== input.email) throw new UnprocessableEntityException('Enter the API user password.');
      creds = saved;
    }
    const test = await this.factory(creds).testConnection();
    if (!test.ok) throw new UnprocessableEntityException({ message: `Could not connect to Shiprocket: ${test.error}`, provider: 'shiprocket' });
    const encrypted = encryptJson(this.key(), creds);
    const settings: ShippingSettings = { pickupLocation: input.pickupLocation, pickupPostcode: input.pickupPostcode, parcel: input.parcel, accountEmail: input.email };
    await this.prisma.$transaction([
      this.prisma.integration.upsert({ where, update: { encryptedCreds: encrypted, status: 'connected', lastTestedAt: new Date(), lastTestResult: test }, create: { organizationId: store.organizationId, provider: 'shiprocket', status: 'connected', scopes: ['delivery'], encryptedCreds: encrypted, lastTestedAt: new Date(), lastTestResult: test } }),
      this.prisma.store.update({ where: { id: storeId }, data: { shippingProvider: 'shiprocket', shippingSettings: settings as unknown as Prisma.InputJsonValue } }),
    ]);
    await this.audit.record({ action: 'store.extension_connected', actorId: user.id, organizationId: store.organizationId, targetType: 'store', targetId: storeId, metadata: { extension: 'shiprocket' } });
    return this.extensions(user, storeId);
  }

  async disconnectShipping(user: AuthUser, storeId: string) {
    const store = await this.merchant.authorize(user, storeId, 'admin');
    if (!store.shippingProvider) return this.extensions(user, storeId);
    await this.prisma.store.update({ where: { id: storeId }, data: { shippingProvider: null, shippingSettings: {} } });
    const others = await this.prisma.store.count({ where: { organizationId: store.organizationId, shippingProvider: store.shippingProvider, deletedAt: null } });
    if (!others) await this.prisma.integration.deleteMany({ where: { organizationId: store.organizationId, provider: store.shippingProvider } });
    await this.audit.record({ action: 'store.extension_disconnected', actorId: user.id, organizationId: store.organizationId, targetType: 'store', targetId: storeId, metadata: { extension: store.shippingProvider } });
    return this.extensions(user, storeId);
  }

  // ───────── Orders ─────────

  private async shippable(storeId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, storeId }, include: { items: { include: { variant: { select: { weightGrams: true } } } }, customer: { select: { phone: true } }, shipment: true } });
    if (!order) throw new NotFoundException('Order not found');
    const a = (order.shippingAddress ?? {}) as Record<string, string | undefined>;
    const phone = (a.phone ?? order.customer?.phone ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    const missing = [!a.name && 'name', !a.line1 && 'address', !a.city && 'city', !a.state && 'state', !/^[1-9][0-9]{5}$/.test(a.postalCode ?? '') && '6-digit PIN code', !/^[6-9][0-9]{9}$/.test(phone) && '10-digit mobile number'].filter(Boolean);
    if ((a.country ?? 'IN') !== 'IN') throw new UnprocessableEntityException({ message: 'Shiprocket delivers within India only; this order ships elsewhere.', code: 'shipping_unsupported_destination' });
    if (missing.length) throw new UnprocessableEntityException({ message: `The delivery address is missing: ${missing.join(', ')}.`, code: 'shipping_address_incomplete' });
    const itemWeight = order.items.reduce((n, i) => n + (i.variant.weightGrams ?? 0) * i.quantity, 0);
    return { order, to: { name: a.name!, line1: a.line1!, line2: a.line2, city: a.city!, state: a.state!, postalCode: a.postalCode!, country: 'IN', phone, email: order.email }, itemWeight };
  }

  async rates(user: AuthUser, storeId: string, orderId: string, weightGrams?: number) {
    const store = await this.merchant.authorize(user, storeId, 'member');
    const { provider, settings } = await this.provider(store);
    const { order, to, itemWeight } = await this.shippable(storeId, orderId);
    const weight = weightGrams ?? (itemWeight || settings.parcel.weightGrams);
    try {
      const couriers = await provider.quote({ pickupPostcode: settings.pickupPostcode, deliveryPostcode: to.postalCode, weightGrams: weight, declaredValueMinor: order.subtotalMinor });
      return { weightGrams: weight, parcel: { ...settings.parcel, weightGrams: weight }, couriers };
    } catch (e) {
      this.rethrow(e);
    }
  }

  /**
   * Books delivery for a paid order: creates the shipment, assigns a courier (AWB) and requests pickup. Safe to call
   * again after a failure: it resumes from the step that failed and never creates a second shipment for the order.
   */
  async book(user: AuthUser, storeId: string, orderId: string, input: z.infer<typeof BookShipmentSchema>) {
    const store = await this.merchant.authorize(user, storeId, 'member');
    const { provider, settings } = await this.provider(store);
    const { order, to, itemWeight } = await this.shippable(storeId, orderId);
    if (!['paid', 'partially_refunded'].includes(order.status)) throw new ConflictException('Only paid orders can be shipped.');
    const parcel = input.parcel ?? { ...settings.parcel, weightGrams: itemWeight || settings.parcel.weightGrams };

    // Claim the order. The unique orderId makes this exclusive across instances.
    let s: Shipment;
    try {
      s = await this.prisma.shipment.create({ data: { storeId, orderId, provider: provider.name, state: 'booking', providerOrderId: '', providerShipmentId: '', parcel } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const cur = await this.prisma.shipment.findUniqueOrThrow({ where: { orderId } });
      if (cur.state === 'cancelled') {
        const claimed = await this.prisma.shipment.updateMany({ where: { id: cur.id, state: 'cancelled' }, data: { state: 'booking', providerOrderId: '', providerShipmentId: '', awb: null, courierName: null, pickupScheduledFor: null, trackingUrl: null, estimatedDelivery: null, providerStatus: null, events: [], lastError: null, parcel, attempt: { increment: 1 } } });
        if (!claimed.count) throw new ConflictException('This order is already being booked.');
      } else if (cur.state === 'booking') {
        const claimed = await this.prisma.shipment.updateMany({ where: { id: cur.id, state: 'booking', updatedAt: { lt: new Date(Date.now() - BOOKING_LOCK_MS) } }, data: { parcel, lastError: null } });
        if (!claimed.count) throw new ConflictException('This order is already being booked. Try again in a minute.');
      } else if (cur.awb && cur.state !== 'awb_assigned') throw new ConflictException('This order already has a shipment.');
      s = await this.prisma.shipment.findUniqueOrThrow({ where: { orderId } });
    }

    const step = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        const message = e instanceof ShippingError ? e.message : 'Unexpected error while booking.';
        // Nothing exists at the provider yet → release the claim entirely so the order can be booked afresh.
        if (!s.providerShipmentId) await this.prisma.shipment.updateMany({ where: { id: s.id, providerShipmentId: '' }, data: { state: 'cancelled', lastError: message } });
        else await this.prisma.shipment.update({ where: { id: s.id }, data: { lastError: message } });
        this.rethrow(e);
      }
    };

    if (!s.providerShipmentId) {
      const created = await step(() => provider.createShipment({
        reference: `${store.slug}-${order.number}${s.attempt > 1 ? `-r${s.attempt}` : ''}`,
        orderDate: order.createdAt, pickupLocation: settings.pickupLocation, to,
        items: order.items.map((i) => ({ name: i.variantTitle && i.variantTitle !== 'Default' ? `${i.productTitle} (${i.variantTitle})` : i.productTitle, sku: i.sku ?? i.variantId.slice(0, 12), quantity: i.quantity, unitPriceMinor: i.unitPriceMinor })),
        subtotalMinor: order.subtotalMinor, parcel: parcel as ParcelInput,
      }));
      s = await this.prisma.shipment.update({ where: { id: s.id }, data: { ...created, state: 'created', lastError: null } });
    }
    if (!s.awb) {
      const awb = await step(() => provider.assignCourier(s.providerShipmentId, input.courierId));
      [s] = await this.prisma.$transaction([
        this.prisma.shipment.update({ where: { id: s.id }, data: { awb: awb.awb, courierName: awb.courierName, state: 'awb_assigned', lastError: null } }),
        this.prisma.order.update({ where: { id: orderId }, data: { fulfillmentStatus: 'fulfilled', fulfilledAt: new Date(), trackingNumber: awb.awb, shippingMethod: awb.courierName } }),
      ]);
      await this.audit.record({ action: 'order.shipment_booked', actorId: user.id, organizationId: store.organizationId, targetType: 'order', targetId: orderId, metadata: { provider: provider.name, courier: awb.courierName } });
    }
    if (s.state === 'awb_assigned') {
      // The parcel is booked; a pickup problem is reported on the shipment and can be retried, not thrown.
      try {
        const p = await provider.requestPickup(s.providerShipmentId);
        s = await this.prisma.shipment.update({ where: { id: s.id }, data: { state: 'pickup_scheduled', pickupScheduledFor: p.scheduledFor, lastError: null } });
      } catch (e) {
        s = await this.prisma.shipment.update({ where: { id: s.id }, data: { lastError: e instanceof ShippingError ? e.message : 'Could not schedule the pickup.' } });
      }
    }
    return this.dto(s);
  }

  private async load(user: AuthUser, storeId: string, orderId: string, min: 'viewer' | 'member') {
    const store = await this.merchant.authorize(user, storeId, min);
    const s = await this.prisma.shipment.findFirst({ where: { orderId, storeId, state: { not: 'booking' } } });
    if (!s || !s.providerShipmentId) throw new NotFoundException('This order has no shipment.');
    return { store, s };
  }

  async get(user: AuthUser, storeId: string, orderId: string) {
    await this.merchant.authorize(user, storeId, 'viewer');
    const s = await this.prisma.shipment.findFirst({ where: { orderId, storeId } });
    return s && s.state !== 'booking' && (s.providerShipmentId || s.lastError) ? this.dto(s) : null;
  }

  async sync(user: AuthUser, storeId: string, orderId: string) {
    const { store, s } = await this.load(user, storeId, orderId, 'member');
    if (!s.awb || s.state === 'cancelled') return this.dto(s);
    const { provider } = await this.provider(store);
    try {
      const t = await provider.track(s.awb);
      // Tracking can lag behind booking: never move a booked parcel backwards to "created".
      const state = t.state === 'created' || (t.state === 'awb_assigned' && s.state === 'pickup_scheduled') ? s.state : t.state;
      const updated = await this.prisma.shipment.update({ where: { id: s.id }, data: { state, providerStatus: t.providerStatus, trackingUrl: t.trackingUrl, estimatedDelivery: t.estimatedDelivery, events: t.events as unknown as Prisma.InputJsonValue, lastSyncedAt: new Date() } });
      if (state === 'returned') await this.prisma.order.update({ where: { id: orderId }, data: { fulfillmentStatus: 'returned' } });
      return this.dto(updated);
    } catch (e) {
      this.rethrow(e);
    }
  }

  async label(user: AuthUser, storeId: string, orderId: string) {
    const { store, s } = await this.load(user, storeId, orderId, 'member');
    if (!s.awb) throw new ConflictException('A courier must be assigned before a label exists.');
    const { provider } = await this.provider(store);
    try {
      return await provider.label(s.providerShipmentId);
    } catch (e) {
      this.rethrow(e);
    }
  }

  async cancel(user: AuthUser, storeId: string, orderId: string) {
    const { store, s } = await this.load(user, storeId, orderId, 'member');
    if (['cancelled', 'delivered', 'returned', 'in_transit', 'out_for_delivery'].includes(s.state)) throw new ConflictException('This shipment can no longer be cancelled.');
    const { provider } = await this.provider(store);
    try {
      await provider.cancel(s.providerOrderId);
    } catch (e) {
      this.rethrow(e);
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.shipment.update({ where: { id: s.id }, data: { state: 'cancelled', lastError: null } }),
      this.prisma.order.updateMany({ where: { id: orderId, trackingNumber: s.awb }, data: { fulfillmentStatus: 'unfulfilled', fulfilledAt: null, trackingNumber: null, shippingMethod: null } }),
    ]);
    await this.audit.record({ action: 'order.shipment_cancelled', actorId: user.id, organizationId: store.organizationId, targetType: 'order', targetId: orderId, metadata: { provider: s.provider } });
    return this.dto(updated);
  }

  private dto(s: Shipment) {
    return { id: s.id, provider: s.provider, state: s.state, providerStatus: s.providerStatus, awb: s.awb, courierName: s.courierName, pickupScheduledFor: s.pickupScheduledFor, trackingUrl: s.trackingUrl, estimatedDelivery: s.estimatedDelivery, events: s.events as { at: string; text: string; location: string | null }[], lastError: s.lastError, parcel: s.parcel as unknown as ParcelInput, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString() };
  }
}
