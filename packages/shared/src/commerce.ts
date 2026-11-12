import { z } from 'zod';

const money = z.number().int().min(0).max(1_000_000_000);
const handle = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(80);
const currency = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. INR');

export const CreateStoreSchema = z.object({
  organizationId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  currency: currency.default('INR'),
  contactEmail: z.email().optional(),
  taxRateBps: z.number().int().min(0).max(5000).default(0),
  pricesIncludeTax: z.boolean().default(true),
});
export type CreateStoreInput = z.infer<typeof CreateStoreSchema>;

export const UpdateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    status: z.enum(['draft', 'active', 'paused']),
    contactEmail: z.email().nullable(),
    taxRateBps: z.number().int().min(0).max(5000),
    pricesIncludeTax: z.boolean(),
    theme: z.record(z.string(), z.unknown()),
  })
  .partial();

export const InventoryInputSchema = z.object({ tracked: z.boolean().default(true), onHand: z.number().int().min(0).max(10_000_000).default(0), lowStockThreshold: z.number().int().min(0).max(100_000).default(5) });

export const VariantInputSchema = z.object({
  title: z.string().trim().min(1).max(120).default('Default'),
  sku: z.string().trim().min(1).max(64).optional(),
  priceMinor: money,
  compareAtMinor: money.optional(),
  options: z.record(z.string().max(40), z.string().max(80)).default({}),
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
  inventory: InventoryInputSchema.default({ tracked: true, onHand: 0, lowStockThreshold: 5 }),
});

export const ProductImageSchema = z.object({ url: z.url().max(2000), alt: z.string().max(200).default('') });

export const CreateProductSchema = z.object({
  title: z.string().trim().min(1).max(200),
  handle: handle.optional(),
  description: z.string().max(20_000).default(''),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  digital: z.boolean().default(false),
  images: z.array(ProductImageSchema).max(20).default([]),
  tags: z.array(z.string().trim().max(40)).max(30).default([]),
  variants: z.array(VariantInputSchema).min(1).max(100),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.omit({ variants: true }).partial();
export const UpdateVariantSchema = VariantInputSchema.omit({ inventory: true }).partial();
export const InventoryAdjustSchema = z.union([
  z.object({ set: z.number().int().min(0).max(10_000_000) }),
  z.object({ adjust: z.number().int().min(-10_000_000).max(10_000_000) }),
]).and(z.object({ lowStockThreshold: z.number().int().min(0).optional(), tracked: z.boolean().optional() }));

export const CreateDiscountSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/),
  type: z.enum(['percentage', 'fixed_amount', 'free_shipping']),
  value: z.number().int().min(0).max(1_000_000_000).default(0),
  minSubtotalMinor: money.default(0),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  usageLimit: z.number().int().min(1).optional(),
}).refine((d) => d.type !== 'percentage' || (d.value > 0 && d.value <= 10_000), { message: 'Percentage value is basis points (1–10000)', path: ['value'] });

export const CreateShippingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rateMinor: money,
  freeOverMinor: money.optional(),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250).default([]),
});

export const ConnectPaymentsSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('razorpay'), keyId: z.string().min(5).max(100), keySecret: z.string().min(5).max(200), webhookSecret: z.string().min(5).max(200) }),
  z.object({ provider: z.literal('stripe'), secretKey: z.string().regex(/^(sk|rk)_(test|live)_/), publishableKey: z.string().regex(/^pk_(test|live)_/), webhookSecret: z.string().regex(/^whsec_/) }),
]);

export const CartLineSchema = z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(100) });
export const AddressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().min(2).max(20),
  country: z.string().regex(/^[A-Z]{2}$/),
  phone: z.string().trim().max(30).optional(),
});

export const QuoteSchema = z.object({
  items: z.array(CartLineSchema).min(1).max(50),
  discountCode: z.string().trim().toUpperCase().max(32).optional(),
  shippingId: z.uuid().optional(),
});

export const CheckoutSchema = QuoteSchema.extend({
  checkoutToken: z.string().min(16).max(100),
  email: z.email().max(254),
  name: z.string().trim().max(120).optional(),
  shippingAddress: AddressSchema.optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

export const RefundSchema = z.object({
  amountMinor: z.number().int().min(1),
  reason: z.string().max(500).default(''),
  restock: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(100),
});

export const FulfillSchema = z.object({ trackingNumber: z.string().trim().max(100).optional() });
