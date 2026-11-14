import { encodeCart, type CheckoutHandoff } from '@mya/shared';
import { API_URL, ApiError } from './api';

/** Public storefront API (no platform sign-in; shoppers are anonymous). */
async function sf<T>(slug: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/storefront/${encodeURIComponent(slug)}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = body as { message?: unknown } | null;
    throw new ApiError(res.status, typeof b?.message === 'string' ? b.message : `Request failed (${res.status})`, body);
  }
  return body as T;
}

export interface ShopInfo { name: string; slug: string; currency: string; pricesIncludeTax: boolean; taxRateBps: number; paymentProvider: string | null; shipping: { id: string; name: string; rateMinor: number; freeOverMinor: number | null; countries: string[] }[] }
export interface ShopQuote { currency: string; needsShipping: boolean; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; lines: { variantId: string; title: string; quantity: number; unitPriceMinor: number; available: boolean }[] }
export interface ShopOrder {
  id: string; number: number; status: string; fulfillmentStatus: string; email: string; currency: string;
  subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; refundedMinor: number;
  items: { title: string; variantTitle: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
  trackingNumber: string | null; createdAt: string; accessToken?: string; payment?: Record<string, string | number> | null;
}
export type Address = { name: string; line1: string; line2?: string; city: string; state?: string; postalCode: string; country: string; phone?: string };
type Cart = Omit<CheckoutHandoff, 'type'>;

export const shop = {
  info: (slug: string) => sf<ShopInfo>(slug, ''),
  quote: (slug: string, c: Cart) => sf<ShopQuote>(slug, '/quote', { method: 'POST', body: JSON.stringify(c) }),
  checkout: (slug: string, body: Cart & { checkoutToken: string; email: string; name?: string; shippingAddress?: Address }) => sf<ShopOrder>(slug, '/checkout', { method: 'POST', body: JSON.stringify(body) }),
  order: (slug: string, id: string, token: string) => sf<ShopOrder>(slug, `/orders/${id}?token=${encodeURIComponent(token)}`),
  confirmRazorpay: (slug: string, id: string, body: { accessToken: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
    sf<ShopOrder>(slug, `/orders/${id}/razorpay/confirm`, { method: 'POST', body: JSON.stringify(body) }),
};

/** Where a shop front's cart goes to pay. The cart rides in the URL fragment, which browsers never send to servers. */
export const checkoutHref = (slug: string, c: Cart) => `/shop/${encodeURIComponent(slug)}/checkout#c=${encodeCart(c)}`;

/** Order access tokens are kept in this tab only (never in URLs that reach servers or logs). */
export const orderToken = {
  save: (id: string, token: string) => { try { sessionStorage.setItem(`order:${id}`, token); } catch { /* private mode */ } },
  get: (id: string) => { try { return sessionStorage.getItem(`order:${id}`); } catch { return null; } },
};

export function formatMoney(minor: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100); } catch { return `${currency} ${(minor / 100).toFixed(2)}`; }
}

function loadScript(src: string, globalName: string): Promise<void> {
  if ((window as unknown as Record<string, unknown>)[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment form. Check your connection and try again.'));
    document.body.appendChild(s);
  });
}
export const loadRazorpay = () => loadScript('https://checkout.razorpay.com/v1/checkout.js', 'Razorpay');
export const loadStripe = () => loadScript('https://js.stripe.com/v3/', 'Stripe');
