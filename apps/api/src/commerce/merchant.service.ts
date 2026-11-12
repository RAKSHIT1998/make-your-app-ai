import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type OrgRole, type PrismaClient, type Store } from '@mya/db';
import type { CreateProductInput, CreateStoreInput } from '@mya/shared';
import { GatewayError, type GatewayCredentials } from '@mya/payments';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { ConnectPaymentsSchema, CreateDiscountSchema, CreateShippingSchema, InventoryAdjustSchema, RefundSchema, UpdateProductSchema, UpdateStoreSchema, UpdateVariantSchema } from '@mya/shared';
import { PRISMA } from '../prisma.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { GatewayRegistry } from './gateways.js';

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

function p2002(e: unknown, message: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(message);
  throw e;
}

const ORDER_INCLUDE = { items: true, payments: { select: { id: true, provider: true, status: true, amountMinor: true, providerPaymentId: true, createdAt: true } }, refunds: true } as const;

@Injectable()
export class MerchantService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(GatewayRegistry) private readonly gateways: GatewayRegistry,
  ) {}

  /** Loads a store and checks the caller's org role. Unknown or foreign stores are 404. */
  async authorize(user: AuthUser, storeId: string, min: OrgRole): Promise<Store> {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, deletedAt: null } });
    if (!store) throw new NotFoundException('Store not found');
    try {
      await this.orgs.assertRole(user.id, store.organizationId, min);
    } catch (e) {
      if (e instanceof NotFoundException) throw new NotFoundException('Store not found');
      throw e;
    }
    return store;
  }

  // ───────── Stores ─────────

  async createStore(user: AuthUser, input: CreateStoreInput) {
    const organizationId = input.organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, organizationId, 'admin');
    if (input.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: input.projectId, organizationId, deletedAt: null } });
      if (!project) throw new NotFoundException('Project not found');
    }
    const slug = `${slugify(input.name)}-${randomBytes(3).toString('hex')}`;
    const store = await this.prisma.store
      .create({ data: { organizationId, projectId: input.projectId ?? null, name: input.name, slug, currency: input.currency, contactEmail: input.contactEmail ?? null, taxRateBps: input.taxRateBps, pricesIncludeTax: input.pricesIncludeTax } })
      .catch((e) => p2002(e, 'That project already has a store.'));
    await this.audit.record({ action: 'store.created', actorId: user.id, organizationId, targetType: 'store', targetId: store.id });
    return store;
  }

  async listStores(user: AuthUser, organizationId?: string) {
    const org = organizationId ?? user.personalOrgId;
    await this.orgs.assertRole(user.id, org, 'viewer');
    return this.prisma.store.findMany({ where: { organizationId: org, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  async getStore(user: AuthUser, storeId: string) {
    const store = await this.authorize(user, storeId, 'viewer');
    return { ...store, payments: await this.gateways.status(store) };
  }

  async updateStore(user: AuthUser, storeId: string, input: z.infer<typeof UpdateStoreSchema>) {
    await this.authorize(user, storeId, 'admin');
    const { theme, ...rest } = input;
    return this.prisma.store.update({ where: { id: storeId }, data: { ...rest, ...(theme ? { theme: theme as Prisma.InputJsonValue } : {}) } });
  }

  async connectPayments(user: AuthUser, storeId: string, input: z.infer<typeof ConnectPaymentsSchema>) {
    const store = await this.authorize(user, storeId, 'admin');
    const creds = input as GatewayCredentials;
    const result = await this.gateways.build(creds).testConnection();
    if (!result.ok) throw new UnprocessableEntityException({ message: `Could not connect to ${input.provider}: ${result.error}`, provider: input.provider });
    await this.gateways.save(store.organizationId, creds, result);
    const updated = await this.prisma.store.update({ where: { id: storeId }, data: { paymentProvider: input.provider } });
    await this.audit.record({ action: 'store.payments_connected', actorId: user.id, organizationId: store.organizationId, targetType: 'store', targetId: storeId, metadata: { provider: input.provider } });
    return this.gateways.status(updated);
  }

  // ───────── Catalog ─────────

  async createProduct(user: AuthUser, storeId: string, input: CreateProductInput) {
    await this.authorize(user, storeId, 'member');
    const handle = input.handle ?? slugify(input.title);
    return this.prisma.product
      .create({
        data: {
          storeId,
          title: input.title,
          handle,
          description: input.description,
          status: input.status,
          digital: input.digital,
          images: input.images as Prisma.InputJsonValue,
          tags: input.tags,
          variants: {
            create: input.variants.map((v, i) => ({
              storeId,
              title: v.title,
              sku: v.sku ?? null,
              priceMinor: v.priceMinor,
              compareAtMinor: v.compareAtMinor ?? null,
              options: v.options,
              weightGrams: v.weightGrams ?? null,
              position: i,
              inventory: { create: { storeId, tracked: v.inventory.tracked, onHand: v.inventory.onHand, lowStockThreshold: v.inventory.lowStockThreshold } },
            })),
          },
        },
        include: { variants: { include: { inventory: true }, orderBy: { position: 'asc' } } },
      })
      .catch((e) => p2002(e, 'A product with that handle, or a variant with that SKU, already exists in this store.'));
  }

  async listProducts(user: AuthUser, storeId: string) {
    await this.authorize(user, storeId, 'viewer');
    return this.prisma.product.findMany({
      where: { storeId, deletedAt: null },
      include: { variants: { include: { inventory: true }, orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateProduct(user: AuthUser, storeId: string, productId: string, input: z.infer<typeof UpdateProductSchema>) {
    await this.authorize(user, storeId, 'member');
    const p = await this.prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
    if (!p) throw new NotFoundException('Product not found');
    const { images, ...rest } = input;
    return this.prisma.product
      .update({ where: { id: productId }, data: { ...rest, ...(images ? { images: images as Prisma.InputJsonValue } : {}) }, include: { variants: { include: { inventory: true } } } })
      .catch((e) => p2002(e, 'A product with that handle already exists.'));
  }

  async deleteProduct(user: AuthUser, storeId: string, productId: string) {
    await this.authorize(user, storeId, 'admin');
    const res = await this.prisma.product.updateMany({ where: { id: productId, storeId, deletedAt: null }, data: { deletedAt: new Date(), status: 'archived' } });
    if (res.count === 0) throw new NotFoundException('Product not found');
  }

  async updateVariant(user: AuthUser, storeId: string, variantId: string, input: z.infer<typeof UpdateVariantSchema>) {
    await this.authorize(user, storeId, 'member');
    const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, storeId } });
    if (!v) throw new NotFoundException('Variant not found');
    return this.prisma.productVariant.update({ where: { id: variantId }, data: input }).catch((e) => p2002(e, 'That SKU is already used in this store.'));
  }

  /** Set or adjust on-hand stock under a row lock. On-hand can never drop below what is reserved by open checkouts. */
  async adjustInventory(user: AuthUser, storeId: string, variantId: string, input: z.infer<typeof InventoryAdjustSchema>) {
    await this.authorize(user, storeId, 'member');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; onHand: number; reserved: number }[]>`SELECT id, "onHand", reserved FROM "Inventory" WHERE "variantId" = ${variantId}::uuid AND "storeId" = ${storeId}::uuid FOR UPDATE`;
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Variant not found');
      const next = 'set' in input ? input.set : inv.onHand + input.adjust;
      if (next < inv.reserved) throw new ConflictException(`Stock can't go below ${inv.reserved}: that many units are reserved by open checkouts.`);
      return tx.inventory.update({
        where: { id: inv.id },
        data: { onHand: next, ...(input.lowStockThreshold !== undefined ? { lowStockThreshold: input.lowStockThreshold } : {}), ...(input.tracked !== undefined ? { tracked: input.tracked } : {}) },
      });
    });
  }

  // ───────── Discounts & shipping ─────────

  async createDiscount(user: AuthUser, storeId: string, input: z.infer<typeof CreateDiscountSchema>) {
    await this.authorize(user, storeId, 'member');
    return this.prisma.discount
      .create({ data: { storeId, code: input.code, type: input.type, value: input.value, minSubtotalMinor: input.minSubtotalMinor, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, usageLimit: input.usageLimit ?? null } })
      .catch((e) => p2002(e, 'That discount code already exists.'));
  }

  async listDiscounts(user: AuthUser, storeId: string) {
    await this.authorize(user, storeId, 'viewer');
    return this.prisma.discount.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
  }

  async setDiscountActive(user: AuthUser, storeId: string, id: string, active: boolean) {
    await this.authorize(user, storeId, 'member');
    const res = await this.prisma.discount.updateMany({ where: { id, storeId }, data: { active } });
    if (!res.count) throw new NotFoundException('Discount not found');
  }

  async createShipping(user: AuthUser, storeId: string, input: z.infer<typeof CreateShippingSchema>) {
    await this.authorize(user, storeId, 'member');
    return this.prisma.shippingConfiguration.create({ data: { storeId, name: input.name, rateMinor: input.rateMinor, freeOverMinor: input.freeOverMinor ?? null, countries: input.countries } });
  }

  async listShipping(user: AuthUser, storeId: string) {
    await this.authorize(user, storeId, 'viewer');
    return this.prisma.shippingConfiguration.findMany({ where: { storeId }, orderBy: { createdAt: 'asc' } });
  }

  // ───────── Orders ─────────

  async listOrders(user: AuthUser, storeId: string, q: { status?: string | undefined; limit: number; cursor?: string | undefined }) {
    await this.authorize(user, storeId, 'viewer');
    const rows = await this.prisma.order.findMany({
      where: { storeId, ...(q.status ? { status: q.status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { items: true },
    });
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async getOrder(user: AuthUser, storeId: string, orderId: string) {
    await this.authorize(user, storeId, 'viewer');
    const order = await this.prisma.order.findFirst({ where: { id: orderId, storeId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async fulfill(user: AuthUser, storeId: string, orderId: string, trackingNumber?: string) {
    const store = await this.authorize(user, storeId, 'member');
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, storeId, status: { in: ['paid', 'partially_refunded'] }, fulfillmentStatus: 'unfulfilled' },
      data: { fulfillmentStatus: 'fulfilled', fulfilledAt: new Date(), trackingNumber: trackingNumber ?? null },
    });
    if (!res.count) throw new ConflictException('Only paid, unfulfilled orders can be fulfilled.');
    await this.audit.record({ action: 'order.fulfilled', actorId: user.id, organizationId: store.organizationId, targetType: 'order', targetId: orderId });
    return this.getOrder(user, storeId, orderId);
  }

  /**
   * Refunds money through the store's gateway. Over-refunding is prevented by reserving the amount on the order
   * (row-locked) before calling the provider, and releasing it if the provider call fails. Idempotent per key.
   */
  async refund(user: AuthUser, storeId: string, orderId: string, input: z.infer<typeof RefundSchema>) {
    const store = await this.authorize(user, storeId, 'admin');
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.orderId !== orderId) throw new ConflictException('Idempotency key already used for a different order.');
      return existing;
    }
    const gateway = await this.gateways.forStore(store);
    if (!gateway) throw new UnprocessableEntityException('Payments are not connected for this store.');

    const { refund, payment } = await this.prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw<{ id: string; status: string; totalMinor: number; refundedMinor: number }[]>`SELECT id, status, "totalMinor", "refundedMinor" FROM "Order" WHERE id = ${orderId}::uuid AND "storeId" = ${storeId}::uuid FOR UPDATE`;
      if (!order) throw new NotFoundException('Order not found');
      if (!['paid', 'partially_refunded'].includes(order.status)) throw new ConflictException('Only paid orders can be refunded.');
      const remaining = order.totalMinor - order.refundedMinor;
      if (input.amountMinor > remaining) throw new BadRequestException(`Refund exceeds the refundable amount (${remaining}).`);
      if (input.restock && input.amountMinor !== remaining) throw new BadRequestException('Restocking is only supported when refunding the full remaining amount.');
      const payment = await tx.payment.findFirst({ where: { orderId, status: 'succeeded' } });
      if (!payment?.providerPaymentId) throw new ConflictException('No captured payment found for this order.');
      await tx.order.update({ where: { id: orderId }, data: { refundedMinor: { increment: input.amountMinor } } });
      const refund = await tx.refund.create({ data: { orderId, paymentId: payment.id, amountMinor: input.amountMinor, reason: input.reason, restock: input.restock, idempotencyKey: input.idempotencyKey, createdById: user.id } });
      return { refund, payment };
    });

    let result;
    try {
      result = await gateway.refund({ providerPaymentId: payment.providerPaymentId!, amountMinor: input.amountMinor, idempotencyKey: input.idempotencyKey });
    } catch (e) {
      await this.prisma.$transaction([
        this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'failed' } }),
        this.prisma.order.update({ where: { id: orderId }, data: { refundedMinor: { decrement: input.amountMinor } } }),
      ]);
      throw new UnprocessableEntityException(`Refund failed: ${e instanceof GatewayError ? e.message : 'payment provider error'}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.update({ where: { id: refund.id }, data: { status: result.status === 'failed' ? 'failed' : result.status, providerRefundId: result.providerRefundId } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      if (result.status === 'failed') {
        await tx.order.update({ where: { id: orderId }, data: { refundedMinor: { decrement: input.amountMinor } } });
        return r;
      }
      await tx.order.update({ where: { id: orderId }, data: { status: order.refundedMinor >= order.totalMinor ? 'refunded' : 'partially_refunded' } });
      if (input.restock) {
        for (const item of order.items) await tx.inventory.updateMany({ where: { variantId: item.variantId, tracked: true }, data: { onHand: { increment: item.quantity } } });
      }
      return r;
    });
    await this.audit.record({ action: 'order.refunded', actorId: user.id, organizationId: store.organizationId, targetType: 'order', targetId: orderId, metadata: { amountMinor: input.amountMinor, status: updated.status } });
    return updated;
  }

  // ───────── Analytics (computed from real orders only) ─────────

  async analytics(user: AuthUser, storeId: string, days: number) {
    const store = await this.authorize(user, storeId, 'viewer');
    const since = new Date(Date.now() - days * 864e5);
    const SOLD = ['paid', 'partially_refunded', 'refunded'] as const;
    const [agg, pending, top, daily, lowStock] = await Promise.all([
      this.prisma.order.aggregate({ where: { storeId, status: { in: [...SOLD] }, paidAt: { gte: since } }, _sum: { totalMinor: true, refundedMinor: true }, _count: true }),
      this.prisma.order.count({ where: { storeId, status: 'pending_payment' } }),
      this.prisma.$queryRaw<{ productTitle: string; units: bigint; revenue: bigint }[]>`
        SELECT i."productTitle", SUM(i.quantity)::bigint AS units, SUM(i."totalMinor")::bigint AS revenue
        FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
        WHERE o."storeId" = ${storeId}::uuid AND o.status IN ('paid','partially_refunded','refunded') AND o."paidAt" >= ${since}
        GROUP BY i."productTitle" ORDER BY revenue DESC LIMIT 5`,
      this.prisma.$queryRaw<{ day: Date; orders: bigint; revenue: bigint }[]>`
        SELECT date_trunc('day', o."paidAt") AS day, COUNT(*)::bigint AS orders, SUM(o."totalMinor")::bigint AS revenue
        FROM "Order" o WHERE o."storeId" = ${storeId}::uuid AND o.status IN ('paid','partially_refunded','refunded') AND o."paidAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ variantId: string; productTitle: string; variantTitle: string; available: number; lowStockThreshold: number }[]>`
        SELECT v.id AS "variantId", p.title AS "productTitle", v.title AS "variantTitle", (inv."onHand" - inv.reserved) AS available, inv."lowStockThreshold"
        FROM "Inventory" inv JOIN "ProductVariant" v ON v.id = inv."variantId" JOIN "Product" p ON p.id = v."productId"
        WHERE inv."storeId" = ${storeId}::uuid AND inv.tracked AND p."deletedAt" IS NULL AND (inv."onHand" - inv.reserved) <= inv."lowStockThreshold"
        ORDER BY available ASC LIMIT 20`,
    ]);
    const gross = agg._sum.totalMinor ?? 0;
    const refunds = agg._sum.refundedMinor ?? 0;
    return {
      currency: store.currency,
      days,
      grossSalesMinor: gross,
      refundsMinor: refunds,
      netSalesMinor: gross - refunds,
      orders: agg._count,
      averageOrderValueMinor: agg._count ? Math.round(gross / agg._count) : 0,
      pendingPaymentOrders: pending,
      topProducts: top.map((t) => ({ productTitle: t.productTitle, units: Number(t.units), revenueMinor: Number(t.revenue) })),
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), orders: Number(d.orders), revenueMinor: Number(d.revenue) })),
      lowStock,
    };
  }
}
