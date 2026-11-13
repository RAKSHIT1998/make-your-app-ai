import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  BookShipmentSchema, CheckoutSchema, ConnectPaymentsSchema, ConnectShiprocketSchema, CreateDiscountSchema, CreateProductSchema, CreateShippingSchema, CreateStoreSchema, FulfillSchema,
  InventoryAdjustSchema, QuoteSchema, RefundSchema, UpdateProductSchema, UpdateStoreSchema, UpdateVariantSchema,
} from '@mya/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { rateLimits } from '../common/rate-limits.js';
import { MerchantService } from './merchant.service.js';
import { StorefrontService } from './storefront.service.js';
import { ShippingService } from './shipping.service.js';

const Uuid = new ParseUUIDPipe();
const OrgQuery = z.object({ organizationId: z.uuid().optional() });
const OrdersQuery = z.object({ status: z.enum(['pending_payment', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'expired']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.uuid().optional() });
const DaysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const ActiveBody = z.object({ active: z.boolean() });
const ProductsQuery = z.object({ q: z.string().max(100).optional(), collection: z.string().max(80).optional() });
const RatesQuery = z.object({ weightGrams: z.coerce.number().int().min(10).max(50_000).optional() });
const TokenQuery = z.object({ token: z.string().min(10).max(200) });
const RazorpayConfirm = z.object({ accessToken: z.string().min(10), razorpayOrderId: z.string().min(1), razorpayPaymentId: z.string().min(1), razorpaySignature: z.string().min(1) });

/** Merchant APIs (authenticated, org-role checked). */
@Controller('stores')
export class MerchantController {
  constructor(@Inject(MerchantService) private readonly m: MerchantService, @Inject(ShippingService) private readonly ship: ShippingService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateStoreSchema)) b: z.infer<typeof CreateStoreSchema>) { return this.m.createStore(u, b); }
  @Get() list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(OrgQuery)) q: z.infer<typeof OrgQuery>) { return this.m.listStores(u, q.organizationId); }
  @Get(':storeId') get(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string) { return this.m.getStore(u, id); }
  @Patch(':storeId') update(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Body(new ZodPipe(UpdateStoreSchema)) b: z.infer<typeof UpdateStoreSchema>) { return this.m.updateStore(u, id, b); }
  @Put(':storeId/payments') payments(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Body(new ZodPipe(ConnectPaymentsSchema)) b: z.infer<typeof ConnectPaymentsSchema>) { return this.m.connectPayments(u, id, b); }

  // Extensions (payments connect above; delivery here). Provider calls share the deploy rate limit (DEPLOY_RATE_LIMIT_PER_MINUTE).
  @Get(':storeId/extensions') extensions(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string) { return this.ship.extensions(u, id); }
  @Put(':storeId/extensions/shiprocket') @Throttle({ default: { limit: () => rateLimits.deploy, ttl: 60_000 } }) connectShiprocket(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Body(new ZodPipe(ConnectShiprocketSchema)) b: z.infer<typeof ConnectShiprocketSchema>) { return this.ship.connectShiprocket(u, id, b); }
  @Delete(':storeId/extensions/shiprocket') disconnectShiprocket(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string) { return this.ship.disconnectShipping(u, id); }
  @Get(':storeId/orders/:orderId/shipping/rates') @Throttle({ default: { limit: () => rateLimits.deploy * 3, ttl: 60_000 } }) rates(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string, @Query(new ZodPipe(RatesQuery)) q: z.infer<typeof RatesQuery>) { return this.ship.rates(u, id, oid, q.weightGrams); }
  @Get(':storeId/orders/:orderId/shipment') shipment(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string) { return this.ship.get(u, id, oid); }
  @Post(':storeId/orders/:orderId/shipment') @HttpCode(200) @Throttle({ default: { limit: () => rateLimits.deploy * 2, ttl: 60_000 } }) book(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string, @Body(new ZodPipe(BookShipmentSchema)) b: z.infer<typeof BookShipmentSchema>) { return this.ship.book(u, id, oid, b); }
  @Post(':storeId/orders/:orderId/shipment/sync') @HttpCode(200) @Throttle({ default: { limit: () => rateLimits.deploy * 3, ttl: 60_000 } }) syncShipment(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string) { return this.ship.sync(u, id, oid); }
  @Get(':storeId/orders/:orderId/shipment/label') @Throttle({ default: { limit: () => rateLimits.deploy * 3, ttl: 60_000 } }) label(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string) { return this.ship.label(u, id, oid); }
  @Post(':storeId/orders/:orderId/shipment/cancel') @HttpCode(200) cancelShipment(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string) { return this.ship.cancel(u, id, oid); }

  @Post(':storeId/products') createProduct(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Body(new ZodPipe(CreateProductSchema)) b: z.infer<typeof CreateProductSchema>) { return this.m.createProduct(u, id, b); }
  @Get(':storeId/products') products(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string) { return this.m.listProducts(u, id); }
  @Patch(':storeId/products/:productId') updateProduct(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('productId', Uuid) pid: string, @Body(new ZodPipe(UpdateProductSchema)) b: z.infer<typeof UpdateProductSchema>) { return this.m.updateProduct(u, id, pid, b); }
  @Delete(':storeId/products/:productId') @HttpCode(204) async deleteProduct(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('productId', Uuid) pid: string) { await this.m.deleteProduct(u, id, pid); }
  @Patch(':storeId/variants/:variantId') updateVariant(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('variantId', Uuid) vid: string, @Body(new ZodPipe(UpdateVariantSchema)) b: z.infer<typeof UpdateVariantSchema>) { return this.m.updateVariant(u, id, vid, b); }
  @Post(':storeId/variants/:variantId/inventory') inventory(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('variantId', Uuid) vid: string, @Body(new ZodPipe(InventoryAdjustSchema)) b: z.infer<typeof InventoryAdjustSchema>) { return this.m.adjustInventory(u, id, vid, b); }

  @Post(':storeId/discounts') createDiscount(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Body(new ZodPipe(CreateDiscountSchema)) b: z.infer<typeof CreateDiscountSchema>) { return this.m.createDiscount(u, id, b); }
  @Get(':storeId/discounts') discounts(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string) { return this.m.listDiscounts(u, id); }
  @Patch(':storeId/discounts/:discountId') @HttpCode(204) async discountActive(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('discountId', Uuid) did: string, @Body(new ZodPipe(ActiveBody)) b: z.infer<typeof ActiveBody>) { await this.m.setDiscountActive(u, id, did, b.active); }
  @Post(':storeId/shipping') createShipping(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Body(new ZodPipe(CreateShippingSchema)) b: z.infer<typeof CreateShippingSchema>) { return this.m.createShipping(u, id, b); }
  @Get(':storeId/shipping') shipping(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string) { return this.m.listShipping(u, id); }

  @Get(':storeId/customers') customers(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Query(new ZodPipe(ProductsQuery)) q: z.infer<typeof ProductsQuery>) { return this.m.listCustomers(u, id, q.q); }
  @Get(':storeId/orders') orders(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Query(new ZodPipe(OrdersQuery)) q: z.infer<typeof OrdersQuery>) { return this.m.listOrders(u, id, q); }
  @Get(':storeId/orders/:orderId') order(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string) { return this.m.getOrder(u, id, oid); }
  @Post(':storeId/orders/:orderId/fulfill') fulfill(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string, @Body(new ZodPipe(FulfillSchema)) b: z.infer<typeof FulfillSchema>) { return this.m.fulfill(u, id, oid, b.trackingNumber); }
  @Post(':storeId/orders/:orderId/refunds') refund(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Param('orderId', Uuid) oid: string, @Body(new ZodPipe(RefundSchema)) b: z.infer<typeof RefundSchema>) { return this.m.refund(u, id, oid, b); }
  @Get(':storeId/analytics') analytics(@CurrentUser() u: AuthUser, @Param('storeId', Uuid) id: string, @Query(new ZodPipe(DaysQuery)) q: z.infer<typeof DaysQuery>) { return this.m.analytics(u, id, q.days); }
}

/** Public storefront API consumed by generated stores. No platform auth; orders are guarded by per-order access tokens. */
@Public()
@Controller('storefront/:slug')
export class StorefrontController {
  constructor(@Inject(StorefrontService) private readonly s: StorefrontService) {}

  @Get() info(@Param('slug') slug: string) { return this.s.storeInfo(slug); }
  @Get('products') products(@Param('slug') slug: string, @Query(new ZodPipe(ProductsQuery)) q: z.infer<typeof ProductsQuery>) { return this.s.products(slug, { query: q.q, collection: q.collection }); }
  @Get('products/:handle') product(@Param('slug') slug: string, @Param('handle') handle: string) { return this.s.product(slug, handle); }
  @Post('quote') @HttpCode(200) quote(@Param('slug') slug: string, @Body(new ZodPipe(QuoteSchema)) b: z.infer<typeof QuoteSchema>) { return this.s.quote(slug, b); }
  @Post('checkout') @Throttle({ default: { limit: () => rateLimits.checkout, ttl: 60_000 } }) checkout(@Param('slug') slug: string, @Body(new ZodPipe(CheckoutSchema)) b: z.infer<typeof CheckoutSchema>) { return this.s.checkout(slug, b); }
  @Get('orders/:orderId') order(@Param('slug') slug: string, @Param('orderId', Uuid) id: string, @Query(new ZodPipe(TokenQuery)) q: z.infer<typeof TokenQuery>) { return this.s.getOrder(slug, id, q.token); }
  @Post('orders/:orderId/razorpay/confirm') @HttpCode(200) confirm(@Param('slug') slug: string, @Param('orderId', Uuid) id: string, @Body(new ZodPipe(RazorpayConfirm)) b: z.infer<typeof RazorpayConfirm>) { return this.s.confirmRazorpay(slug, id, b); }
}

/** Payment provider webhooks. Verified against the raw request body. */
@Public()
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(@Inject(StorefrontService) private readonly s: StorefrontService) {}

  @Post(':provider/:storeId')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  receive(@Param('provider') provider: string, @Param('storeId', Uuid) storeId: string, @Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string>) {
    if (provider !== 'razorpay' && provider !== 'stripe') return { received: false };
    return this.s.handleWebhook(provider, storeId, req.rawBody, headers);
  }
}
