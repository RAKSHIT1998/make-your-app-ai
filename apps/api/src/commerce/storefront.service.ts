import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type PrismaClient, type Store } from '@mya/db';
import type { CheckoutInput } from '@mya/shared';
import { RazorpayGateway, WebhookSignatureError, type NormalizedEvent, type PaymentProviderName } from '@mya/payments';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { GatewayRegistry } from './gateways.js';
import { quote, type Quote } from './pricing.js';

type Tx = Prisma.TransactionClient;
interface Line { variantId: string; quantity: number }

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Public, unauthenticated storefront API used by generated stores + the payment webhook/settlement logic. */
@Injectable()
export class StorefrontService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StorefrontService.name);
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GatewayRegistry) private readonly gateways: GatewayRegistry,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return; // tests call releaseExpired() directly
    this.sweeper = setInterval(() => void this.releaseExpired().catch((e) => this.log.error(e)), 60_000);
  }
  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  private async publicStore(slug: string, previewKey?: string): Promise<Store> {
    const store = await this.prisma.store.findFirst({ where: { slug, deletedAt: null } });
    if (store?.status === 'active') return store;
    // The builder's preview may read a draft store's catalogue (never check out) with its project's secret preview key.
    if (store?.projectId && previewKey && previewKey.length <= 200) {
      const b = await this.prisma.appBackend.findUnique({ where: { projectId: store.projectId }, select: { previewKey: true } });
      if (b && sameSecret(b.previewKey, previewKey)) return store;
    }
    throw new NotFoundException('Store not found');
  }

  // ───────── Catalog ─────────

  async storeInfo(slug: string, previewKey?: string) {
    const s = await this.publicStore(slug, previewKey);
    const shipping = await this.prisma.shippingConfiguration.findMany({ where: { storeId: s.id, active: true }, select: { id: true, name: true, rateMinor: true, freeOverMinor: true, countries: true } });
    return { name: s.name, slug: s.slug, currency: s.currency, theme: s.theme, pricesIncludeTax: s.pricesIncludeTax, taxRateBps: s.taxRateBps, paymentProvider: s.paymentProvider, shipping };
  }

  private publicProduct(p: Prisma.ProductGetPayload<{ include: { variants: { include: { inventory: true } } } }>) {
    return {
      id: p.id, title: p.title, handle: p.handle, description: p.description, images: p.images, tags: p.tags, digital: p.digital,
      variants: p.variants.map((v) => ({
        id: v.id, title: v.title, sku: v.sku, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor, options: v.options,
        // Shoppers see availability, not exact stock counts.
        available: !v.inventory || !v.inventory.tracked || v.inventory.onHand - v.inventory.reserved > 0,
      })),
    };
  }

  async products(slug: string, q: { query?: string | undefined; collection?: string | undefined }, previewKey?: string) {
    const s = await this.publicStore(slug, previewKey);
    const rows = await this.prisma.product.findMany({
      where: {
        storeId: s.id, status: 'active', deletedAt: null,
        ...(q.query ? { OR: [{ title: { contains: q.query, mode: 'insensitive' } }, { tags: { has: q.query.toLowerCase() } }] } : {}),
        ...(q.collection ? { collections: { some: { collection: { handle: q.collection } } } } : {}),
      },
      include: { variants: { include: { inventory: true }, orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((p) => this.publicProduct(p));
  }

  async product(slug: string, handle: string, previewKey?: string) {
    const s = await this.publicStore(slug, previewKey);
    const p = await this.prisma.product.findFirst({ where: { storeId: s.id, handle, status: 'active', deletedAt: null }, include: { variants: { include: { inventory: true }, orderBy: { position: 'asc' } } } });
    if (!p) throw new NotFoundException('Product not found');
    return this.publicProduct(p);
  }

  // ───────── Pricing ─────────

  private mergeLines(items: Line[]): Line[] {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.variantId, (m.get(i.variantId) ?? 0) + i.quantity);
    if ([...m.values()].some((q) => q > 100)) throw new BadRequestException('Maximum quantity per item is 100.');
    return [...m].map(([variantId, quantity]) => ({ variantId, quantity }));
  }

  /** Prices a cart against live catalog data. `db` may be a transaction (with locks already taken). */
  private async priceCart(db: Tx | PrismaClient, store: Store, input: { items: Line[]; discountCode?: string | undefined; shippingId?: string | undefined }, lockDiscount = false) {
    const lines = this.mergeLines(input.items);
    const variants = await db.productVariant.findMany({
      where: { id: { in: lines.map((l) => l.variantId) }, storeId: store.id, product: { status: 'active', deletedAt: null } },
      include: { product: true, inventory: true },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const missing = lines.filter((l) => !byId.has(l.variantId));
    if (missing.length) throw new UnprocessableEntityException({ message: 'Some items are no longer available.', unavailable: missing.map((m) => m.variantId) });

    let discount: Prisma.DiscountGetPayload<object> | null = null;
    if (input.discountCode) {
      if (lockDiscount) await db.$queryRaw`SELECT id FROM "Discount" WHERE "storeId" = ${store.id}::uuid AND code = ${input.discountCode} FOR UPDATE`;
      discount = await db.discount.findUnique({ where: { storeId_code: { storeId: store.id, code: input.discountCode } } });
      const now = new Date();
      if (!discount || !discount.active || (discount.startsAt && discount.startsAt > now) || (discount.endsAt && discount.endsAt < now) || (discount.usageLimit !== null && discount.usageCount >= discount.usageLimit)) {
        throw new UnprocessableEntityException({ message: 'That discount code is not valid.', field: 'discountCode' });
      }
    }

    const needsShipping = variants.some((v) => !v.product.digital);
    let shipping: { id: string; name: string; rateMinor: number; freeOverMinor: number | null } | null = null;
    if (needsShipping) {
      const options = await db.shippingConfiguration.findMany({ where: { storeId: store.id, active: true } });
      if (options.length) {
        if (!input.shippingId) throw new UnprocessableEntityException({ message: 'Choose a shipping method.', field: 'shippingId' });
        shipping = options.find((o) => o.id === input.shippingId) ?? null;
        if (!shipping) throw new UnprocessableEntityException({ message: 'That shipping method is not available.', field: 'shippingId' });
      }
    }

    const priced = lines.map((l) => ({ ...l, variant: byId.get(l.variantId)! }));
    const subtotal = priced.reduce((n, l) => n + l.variant.priceMinor * l.quantity, 0);
    if (discount && subtotal < discount.minSubtotalMinor) throw new UnprocessableEntityException({ message: `This code needs a minimum order of ${discount.minSubtotalMinor}.`, field: 'discountCode' });

    const totals: Quote = quote({
      lines: priced.map((l) => ({ unitPriceMinor: l.variant.priceMinor, quantity: l.quantity })),
      discount: discount ? { type: discount.type, value: discount.value } : null,
      shipping: shipping ? { rateMinor: shipping.rateMinor, freeOverMinor: shipping.freeOverMinor } : null,
      taxRateBps: store.taxRateBps,
      pricesIncludeTax: store.pricesIncludeTax,
    });
    return { priced, discount, shipping, needsShipping, totals };
  }

  async quote(slug: string, input: { items: Line[]; discountCode?: string | undefined; shippingId?: string | undefined }, previewKey?: string) {
    const store = await this.publicStore(slug, previewKey);
    const { priced, totals, needsShipping } = await this.priceCart(this.prisma, store, input);
    return {
      currency: store.currency,
      needsShipping,
      ...totals,
      lines: priced.map((l) => ({ variantId: l.variantId, title: `${l.variant.product.title} — ${l.variant.title}`, quantity: l.quantity, unitPriceMinor: l.variant.priceMinor, available: !l.variant.inventory?.tracked || l.variant.inventory.onHand - l.variant.inventory.reserved >= l.quantity })),
    };
  }

  // ───────── Checkout ─────────

  private orderView(order: Prisma.OrderGetPayload<{ include: { items: true; payments: true } }>, includeToken: boolean) {
    const payment = order.payments.find((p) => p.status !== 'failed') ?? order.payments[0];
    return {
      id: order.id, number: order.number, status: order.status, fulfillmentStatus: order.fulfillmentStatus, email: order.email, currency: order.currency,
      subtotalMinor: order.subtotalMinor, discountMinor: order.discountMinor, shippingMinor: order.shippingMinor, taxMinor: order.taxMinor, totalMinor: order.totalMinor, refundedMinor: order.refundedMinor,
      items: order.items.map((i) => ({ title: i.productTitle, variantTitle: i.variantTitle, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
      trackingNumber: order.trackingNumber, reservationExpiresAt: order.reservationExpiresAt.toISOString(), createdAt: order.createdAt.toISOString(),
      ...(includeToken ? { accessToken: order.accessToken, payment: payment ? payment.clientParams : null } : {}),
    };
  }

  /**
   * Transactional checkout: locks the stock rows (and discount), re-prices from live data, reserves inventory,
   * creates the order, then opens a payment with the store's gateway. Retrying with the same checkoutToken
   * returns the same order — never a duplicate.
   */
  async checkout(slug: string, input: CheckoutInput) {
    const store = await this.publicStore(slug);
    const existing = await this.prisma.order.findUnique({ where: { checkoutToken: input.checkoutToken }, include: { items: true, payments: true } });
    if (existing) {
      if (existing.storeId !== store.id) throw new ConflictException('Checkout token already used.');
      return this.orderView(existing, true);
    }
    const gateway = await this.gateways.forStore(store);
    if (!gateway) throw new HttpException({ message: 'This store is not accepting payments yet.', setupRequired: true }, HttpStatus.SERVICE_UNAVAILABLE);

    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const lines = this.mergeLines(input.items);
        // Lock inventory rows in a stable order to avoid deadlocks between concurrent checkouts.
        const ids = lines.map((l) => l.variantId).sort();
        const locked = await tx.$queryRaw<{ variantId: string; tracked: boolean; onHand: number; reserved: number }[]>`
          SELECT "variantId", tracked, "onHand", reserved FROM "Inventory" WHERE "storeId" = ${store.id}::uuid AND "variantId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "variantId" FOR UPDATE`;
        const stock = new Map(locked.map((r) => [r.variantId, r]));
        const { priced, discount, shipping, needsShipping, totals } = await this.priceCart(tx, store, input, true);
        if (needsShipping && !input.shippingAddress) throw new UnprocessableEntityException({ message: 'A shipping address is required.', field: 'shippingAddress' });
        const short = priced.filter((l) => {
          const s = stock.get(l.variantId);
          return s && s.tracked && s.onHand - s.reserved < l.quantity;
        });
        if (short.length) throw new ConflictException({ message: 'Some items do not have enough stock.', outOfStock: short.map((l) => ({ variantId: l.variantId, title: l.variant.product.title, available: Math.max(0, stock.get(l.variantId)!.onHand - stock.get(l.variantId)!.reserved) })) });

        for (const l of priced) {
          if (stock.get(l.variantId)?.tracked) await tx.inventory.update({ where: { variantId: l.variantId }, data: { reserved: { increment: l.quantity } } });
        }
        if (discount) await tx.discount.update({ where: { id: discount.id }, data: { usageCount: { increment: 1 } } });
        const [seq] = await tx.$queryRaw<{ number: number }[]>`UPDATE "Store" SET "nextOrderNumber" = "nextOrderNumber" + 1 WHERE id = ${store.id}::uuid RETURNING "nextOrderNumber" - 1 AS number`;
        const customer = await tx.customer.upsert({
          where: { storeId_email: { storeId: store.id, email: input.email.toLowerCase() } },
          update: input.name ? { name: input.name } : {},
          create: { storeId: store.id, email: input.email.toLowerCase(), name: input.name ?? null },
        });
        return tx.order.create({
          data: {
            storeId: store.id, number: seq!.number, customerId: customer.id, email: input.email.toLowerCase(), currency: store.currency,
            ...totals, discountCode: discount?.code ?? null, shippingMethod: shipping?.name ?? null,
            shippingAddress: (input.shippingAddress ?? {}) as Prisma.InputJsonValue,
            checkoutToken: input.checkoutToken, accessToken: randomBytes(24).toString('base64url'),
            reservationExpiresAt: new Date(Date.now() + this.config.CHECKOUT_RESERVATION_MINUTES * 60_000),
            items: { create: priced.map((l) => ({ variantId: l.variantId, productTitle: l.variant.product.title, variantTitle: l.variant.title, sku: l.variant.sku, unitPriceMinor: l.variant.priceMinor, quantity: l.quantity, totalMinor: l.variant.priceMinor * l.quantity })) },
          },
        });
      });
    } catch (e) {
      // A concurrent request with the same token won the race: return its order.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const o = await this.prisma.order.findUnique({ where: { checkoutToken: input.checkoutToken }, include: { items: true, payments: true } });
        if (o) return this.orderView(o, true);
      }
      throw e;
    }

    if (order.totalMinor === 0) {
      // Fully discounted: nothing to charge.
      await this.prisma.$transaction((tx) => this.settleStock(tx, order.id, new Date()));
    } else {
      try {
        const created = await gateway.createPayment({ amountMinor: order.totalMinor, currency: order.currency, orderId: order.id, receipt: `#${order.number}`, idempotencyKey: `checkout:${order.id}` });
        await this.prisma.payment.create({ data: { orderId: order.id, storeId: store.id, provider: gateway.name, providerOrderId: created.providerOrderId, amountMinor: order.totalMinor, currency: order.currency, clientParams: created.clientParams } });
      } catch (e) {
        this.log.warn(`payment creation failed for order ${order.id}: ${e instanceof Error ? e.message : e}`);
        await this.prisma.$transaction((tx) => this.releaseOrder(tx, order.id, 'cancelled'));
        throw new HttpException({ message: 'The payment provider could not start this payment. Please try again.' }, HttpStatus.BAD_GATEWAY);
      }
    }
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, payments: true } });
    return this.orderView(full, true);
  }

  async getOrder(slug: string, orderId: string, token: string) {
    const store = await this.publicStore(slug);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, storeId: store.id }, include: { items: true, payments: true } });
    if (!order || !sameSecret(order.accessToken, token)) throw new NotFoundException('Order not found');
    return this.orderView(order, false);
  }

  // ───────── Settlement ─────────

  /** Converts reservations into sales: on-hand and reserved both drop by the ordered quantity. */
  private async settleStock(tx: Tx, orderId: string, paidAt: Date) {
    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const i of items) {
      await tx.inventory.updateMany({ where: { variantId: i.variantId, tracked: true }, data: { onHand: { decrement: i.quantity }, reserved: { decrement: i.quantity } } });
    }
    await tx.order.update({ where: { id: orderId }, data: { status: 'paid', paidAt } });
  }

  /** Releases reserved stock and discount usage for an unpaid order. */
  private async releaseOrder(tx: Tx, orderId: string, status: 'cancelled' | 'expired') {
    const [o] = await tx.$queryRaw<{ status: string; storeId: string; discountCode: string | null }[]>`SELECT status, "storeId", "discountCode" FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (!o || o.status !== 'pending_payment') return false;
    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const i of items) await tx.inventory.updateMany({ where: { variantId: i.variantId, tracked: true }, data: { reserved: { decrement: i.quantity } } });
    if (o.discountCode) await tx.discount.updateMany({ where: { storeId: o.storeId, code: o.discountCode, usageCount: { gt: 0 } }, data: { usageCount: { decrement: 1 } } });
    await tx.order.update({ where: { id: orderId }, data: { status, cancelledAt: new Date() } });
    return true;
  }

  /** Marks payment captured and the order paid. Idempotent; rejects amount/currency mismatches. */
  private async applyPaymentSuccess(provider: PaymentProviderName, providerOrderId: string, providerPaymentId: string | null, amountMinor: number | null, currency: string | null): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { providerOrderId } });
      if (!payment || payment.provider !== provider) return 'unknown_payment';
      const [order] = await tx.$queryRaw<{ id: string; status: string; totalMinor: number; currency: string }[]>`SELECT id, status, "totalMinor", currency FROM "Order" WHERE id = ${payment.orderId}::uuid FOR UPDATE`;
      if (!order) return 'unknown_order';
      if (payment.status === 'succeeded') return 'already_processed';
      if ((amountMinor !== null && amountMinor !== payment.amountMinor) || (currency !== null && currency.toUpperCase() !== payment.currency)) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: `Amount/currency mismatch: got ${amountMinor} ${currency}` } });
        this.log.error(`payment ${payment.id} amount mismatch (expected ${payment.amountMinor} ${payment.currency}, got ${amountMinor} ${currency})`);
        return 'amount_mismatch';
      }
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'succeeded', providerPaymentId: providerPaymentId ?? payment.providerPaymentId } });
      if (order.status === 'pending_payment') {
        await this.settleStock(tx, order.id, new Date());
        return 'order_paid';
      }
      // Paid after the reservation expired. Take stock again if it's there; otherwise flag for the merchant to refund.
      const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
      for (const i of items) {
        const ok = await tx.inventory.count({ where: { variantId: i.variantId, OR: [{ tracked: false }, { onHand: { gte: i.quantity } }] } });
        if (!ok) return 'paid_after_expiry_needs_refund';
      }
      for (const i of items) await tx.inventory.updateMany({ where: { variantId: i.variantId, tracked: true }, data: { onHand: { decrement: i.quantity } } });
      await tx.order.update({ where: { id: order.id }, data: { status: 'paid', paidAt: new Date(), cancelledAt: null } });
      return 'order_paid_after_expiry';
    });
  }

  /** Verified provider webhooks. Each event id is processed at most once. */
  async handleWebhook(provider: PaymentProviderName, storeId: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    if (!rawBody) throw new BadRequestException('Missing body');
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.paymentProvider !== provider) throw new NotFoundException('Unknown webhook endpoint');
    const gateway = await this.gateways.forStore(store);
    if (!gateway) throw new NotFoundException('Unknown webhook endpoint');
    let event: NormalizedEvent;
    try {
      event = gateway.verifyWebhook(rawBody, headers);
    } catch (e) {
      if (e instanceof WebhookSignatureError) throw new BadRequestException('Invalid signature');
      throw e;
    }
    try {
      await this.prisma.paymentWebhookEvent.create({ data: { provider, eventId: event.eventId, type: event.type, storeId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { received: true, duplicate: true };
      throw e;
    }
    let outcome = 'ignored';
    if (event.type === 'payment.succeeded' && event.providerOrderId) {
      outcome = await this.applyPaymentSuccess(provider, event.providerOrderId, event.providerPaymentId, event.amountMinor, event.currency);
    } else if (event.type === 'payment.failed' && event.providerOrderId) {
      const r = await this.prisma.payment.updateMany({ where: { providerOrderId: event.providerOrderId, status: 'created' }, data: { status: 'failed', failureReason: 'Declined by provider' } });
      outcome = r.count ? 'payment_failed' : 'no_change';
    }
    await this.prisma.paymentWebhookEvent.update({ where: { provider_eventId: { provider, eventId: event.eventId } }, data: { processedAt: new Date(), outcome } });
    return { received: true, outcome };
  }

  /** Razorpay Checkout success callback (browser → our API), verified with the key secret. Webhooks remain the backstop. */
  async confirmRazorpay(slug: string, orderId: string, body: { accessToken: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    const store = await this.publicStore(slug);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, storeId: store.id }, include: { payments: true } });
    if (!order || !sameSecret(order.accessToken, body.accessToken)) throw new NotFoundException('Order not found');
    const gateway = await this.gateways.forStore(store);
    if (!(gateway instanceof RazorpayGateway)) throw new BadRequestException('This store does not use Razorpay.');
    if (!order.payments.some((p) => p.providerOrderId === body.razorpayOrderId)) throw new BadRequestException('Payment does not belong to this order.');
    if (!gateway.verifyCheckoutSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature)) throw new BadRequestException('Invalid payment signature');
    const outcome = await this.applyPaymentSuccess('razorpay', body.razorpayOrderId, body.razorpayPaymentId, null, null);
    return { outcome, order: await this.getOrder(slug, orderId, body.accessToken) };
  }

  /** Expires unpaid checkouts past their reservation window, releasing stock and discount usage. */
  async releaseExpired(now = new Date()): Promise<number> {
    const due = await this.prisma.order.findMany({ where: { status: 'pending_payment', reservationExpiresAt: { lt: now } }, select: { id: true }, take: 200 });
    let n = 0;
    for (const o of due) if (await this.prisma.$transaction((tx) => this.releaseOrder(tx, o.id, 'expired'))) n++;
    return n;
  }
}
