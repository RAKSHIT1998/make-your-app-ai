export interface PricedLine {
  unitPriceMinor: number;
  quantity: number;
}

export interface DiscountRule {
  type: 'percentage' | 'fixed_amount' | 'free_shipping';
  value: number;
}

export interface QuoteInput {
  lines: PricedLine[];
  discount: DiscountRule | null;
  shipping: { rateMinor: number; freeOverMinor: number | null } | null;
  taxRateBps: number;
  pricesIncludeTax: boolean;
}

export interface Quote {
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Deterministic integer pricing. Order: subtotal → discount (never below 0) → shipping (free-over uses the
 * discounted subtotal) → tax on the discounted goods (shipping untaxed). With tax-inclusive prices the tax is
 * the included portion and does not change the total.
 */
export function quote(input: QuoteInput): Quote {
  const subtotalMinor = input.lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0);
  let discountMinor = 0;
  if (input.discount?.type === 'percentage') discountMinor = Math.floor((subtotalMinor * Math.min(input.discount.value, 10_000)) / 10_000);
  if (input.discount?.type === 'fixed_amount') discountMinor = Math.min(input.discount.value, subtotalMinor);
  const goods = subtotalMinor - discountMinor;

  let shippingMinor = 0;
  if (input.shipping) {
    const free = input.discount?.type === 'free_shipping' || (input.shipping.freeOverMinor !== null && goods >= input.shipping.freeOverMinor);
    shippingMinor = free ? 0 : input.shipping.rateMinor;
  }

  const rate = input.taxRateBps;
  const taxMinor = rate <= 0 ? 0 : input.pricesIncludeTax ? Math.round(goods - goods / (1 + rate / 10_000)) : Math.round((goods * rate) / 10_000);
  const totalMinor = goods + shippingMinor + (input.pricesIncludeTax ? 0 : taxMinor);
  return { subtotalMinor, discountMinor, shippingMinor, taxMinor, totalMinor };
}
