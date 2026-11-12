import { describe, expect, it } from 'vitest';
import { quote } from '../src/commerce/pricing.js';
import { decryptJson, encryptJson } from '../src/common/crypto.js';

const base = { discount: null, shipping: null, taxRateBps: 0, pricesIncludeTax: true };

describe('pricing', () => {
  it('sums lines', () => {
    expect(quote({ ...base, lines: [{ unitPriceMinor: 49900, quantity: 2 }, { unitPriceMinor: 100, quantity: 3 }] })).toEqual({ subtotalMinor: 100100, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 100100 });
  });
  it('applies percentage and fixed discounts without going negative', () => {
    expect(quote({ ...base, lines: [{ unitPriceMinor: 1000, quantity: 1 }], discount: { type: 'percentage', value: 1500 } }).totalMinor).toBe(850);
    expect(quote({ ...base, lines: [{ unitPriceMinor: 1000, quantity: 1 }], discount: { type: 'fixed_amount', value: 5000 } }).totalMinor).toBe(0);
  });
  it('handles shipping thresholds and free-shipping codes', () => {
    const shipping = { rateMinor: 9900, freeOverMinor: 100000 };
    expect(quote({ ...base, lines: [{ unitPriceMinor: 50000, quantity: 1 }], shipping }).shippingMinor).toBe(9900);
    expect(quote({ ...base, lines: [{ unitPriceMinor: 50000, quantity: 2 }], shipping }).shippingMinor).toBe(0);
    expect(quote({ ...base, lines: [{ unitPriceMinor: 500, quantity: 1 }], shipping, discount: { type: 'free_shipping', value: 0 } }).shippingMinor).toBe(0);
  });
  it('computes inclusive (GST-style) and exclusive tax', () => {
    expect(quote({ ...base, lines: [{ unitPriceMinor: 11800, quantity: 1 }], taxRateBps: 1800, pricesIncludeTax: true })).toMatchObject({ taxMinor: 1800, totalMinor: 11800 });
    expect(quote({ ...base, lines: [{ unitPriceMinor: 10000, quantity: 1 }], taxRateBps: 825, pricesIncludeTax: false })).toMatchObject({ taxMinor: 825, totalMinor: 10825 });
  });
});

describe('credential encryption', () => {
  it('round-trips and detects tampering', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const enc = encryptJson(key, { keySecret: 's3cret' });
    expect(enc).not.toContain('s3cret');
    expect(decryptJson(key, enc)).toEqual({ keySecret: 's3cret' });
    const bad = Buffer.from(enc, 'base64');
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    expect(() => decryptJson(key, bad.toString('base64'))).toThrow();
  });
});
