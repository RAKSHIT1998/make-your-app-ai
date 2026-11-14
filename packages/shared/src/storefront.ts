/**
 * Online stores: the AI writes the shop front (HTML/CSS/JS, sandboxed like every generated app); the platform's
 * commerce engine holds products, stock, prices, discounts and orders. The shop front reaches it only through the
 * injected `Store` object, and payment never happens inside generated code: Store.checkout() hands the cart to the page
 * around the shop, which sends the shopper to the platform-hosted checkout (Razorpay or Stripe, the merchant's account).
 */
export const STOREFRONT_FILE = 'storefront.json';

export interface StorefrontConfig {
  /** `${PUBLIC_API_URL}/api/v1/storefront/<slug>` */
  api: string;
  slug: string;
  mode: 'preview' | 'live';
  /** Builder preview only: lets the draft store's real catalogue load before the store goes live. */
  previewKey?: string;
}

/** The message a shop front posts to its parent page to start checkout. The parent re-validates every field. */
export interface CheckoutHandoff {
  type: 'mya:checkout';
  items: { variantId: string; quantity: number }[];
  discountCode?: string;
  shippingId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parent-side validation of a checkout hand-off message from the sandboxed shop. Returns null for anything else. */
export function parseCheckoutHandoff(data: unknown): CheckoutHandoff | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'mya:checkout' || !Array.isArray(d.items) || d.items.length === 0 || d.items.length > 50) return null;
  const items: CheckoutHandoff['items'] = [];
  for (const raw of d.items) {
    const i = raw as Record<string, unknown>;
    if (typeof i?.variantId !== 'string' || !UUID.test(i.variantId)) return null;
    if (typeof i.quantity !== 'number' || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99) return null;
    items.push({ variantId: i.variantId, quantity: i.quantity });
  }
  const code = typeof d.discountCode === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(d.discountCode) ? d.discountCode : undefined;
  const ship = typeof d.shippingId === 'string' && UUID.test(d.shippingId) ? d.shippingId : undefined;
  return { type: 'mya:checkout', items, ...(code ? { discountCode: code } : {}), ...(ship ? { shippingId: ship } : {}) };
}

/** Cart as carried to the hosted checkout in the URL fragment (never sent to servers in the URL). */
export function encodeCart(c: Omit<CheckoutHandoff, 'type'>): string {
  const json = JSON.stringify({ i: c.items.map((x) => [x.variantId, x.quantity]), d: c.discountCode, s: c.shippingId });
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCart(s: string): Omit<CheckoutHandoff, 'type'> | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8');
    const o = JSON.parse(json) as { i?: [string, number][]; d?: string; s?: string };
    const h = parseCheckoutHandoff({ type: 'mya:checkout', items: (o.i ?? []).map(([variantId, quantity]) => ({ variantId, quantity })), discountCode: o.d, shippingId: o.s });
    return h ? { items: h.items, ...(h.discountCode ? { discountCode: h.discountCode } : {}), ...(h.shippingId ? { shippingId: h.shippingId } : {}) } : null;
  } catch { return null; }
}

/** The `Store` SDK injected into a shop front. ES5, no dependencies, read-only access plus an in-memory cart. */
export const STORE_SDK_SOURCE = `(function () {
  'use strict';
  var cfg = window.__STORE__ || {};
  var lines = [], listeners = [], info = null;
  function StoreError(message, status) { var e = new Error(message); e.name = 'StoreError'; e.status = status; return e; }
  function req(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (cfg.previewKey) headers['x-store-preview'] = cfg.previewKey;
    var x = new XMLHttpRequest();
    return new Promise(function (resolve, reject) {
      x.open(method, cfg.api + path);
      for (var h in headers) x.setRequestHeader(h, headers[h]);
      x.onload = function () {
        var data = null; try { data = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) return resolve(data);
        var msg = data && typeof data.message === 'string' ? data.message : null;
        if (x.status === 404 && !msg) msg = 'Not found.';
        if (x.status === 404 && path === '') msg = cfg.mode === 'preview' ? 'This store could not be loaded.' : 'This store is not open yet. Please check back soon.';
        reject(StoreError(msg || 'Something went wrong. Please try again.', x.status));
      };
      x.onerror = function () { reject(StoreError('Could not reach the store. Check your connection and try again.', 0)); };
      x.send(body ? JSON.stringify(body) : null);
    });
  }
  function emit() { var snap = cart.items(); for (var i = 0; i < listeners.length; i++) { try { listeners[i](snap); } catch (e) {} } }
  function find(id) { for (var i = 0; i < lines.length; i++) if (lines[i].variantId === id) return i; return -1; }
  var cart = Object.freeze({
    items: function () { return lines.map(function (l) { return { variantId: l.variantId, quantity: l.quantity, title: l.title, variantTitle: l.variantTitle, priceMinor: l.priceMinor, image: l.image }; }); },
    count: function () { var n = 0; for (var i = 0; i < lines.length; i++) n += lines[i].quantity; return n; },
    subtotalMinor: function () { var n = 0; for (var i = 0; i < lines.length; i++) n += lines[i].quantity * (lines[i].priceMinor || 0); return n; },
    add: function (product, variant, quantity) {
      if (!product || !variant || typeof variant.id !== 'string') throw StoreError('Pass a product and one of its variants from Store.products() or Store.product().', 400);
      if (variant.available === false) throw StoreError('This item is out of stock.', 409);
      var q = Math.max(1, Math.min(99, Math.floor(quantity || 1))), i = find(variant.id);
      if (i >= 0) lines[i].quantity = Math.min(99, lines[i].quantity + q);
      else lines.push({ variantId: variant.id, quantity: q, title: product.title || '', variantTitle: variant.title || '', priceMinor: variant.priceMinor || 0, image: (product.images && product.images[0]) || null });
      emit();
    },
    setQuantity: function (variantId, quantity) { var i = find(variantId); if (i < 0) return; var q = Math.floor(quantity); if (q <= 0) lines.splice(i, 1); else lines[i].quantity = Math.min(99, q); emit(); },
    remove: function (variantId) { var i = find(variantId); if (i >= 0) { lines.splice(i, 1); emit(); } },
    clear: function () { lines = []; emit(); },
    onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (l) { return l !== cb; }); }; }
  });
  function payload(opts) { opts = opts || {}; var p = { items: lines.map(function (l) { return { variantId: l.variantId, quantity: l.quantity }; }) }; if (opts.discountCode) p.discountCode = String(opts.discountCode); if (opts.shippingId) p.shippingId = String(opts.shippingId); return p; }
  window.Store = Object.freeze({
    mode: cfg.mode || 'live',
    info: function () { return info ? Promise.resolve(info) : req('GET', '').then(function (d) { info = d; return d; }); },
    products: function (opts) { opts = opts || {}; var q = []; if (opts.query) q.push('q=' + encodeURIComponent(opts.query)); if (opts.collection) q.push('collection=' + encodeURIComponent(opts.collection)); return req('GET', '/products' + (q.length ? '?' + q.join('&') : '')); },
    product: function (handle) { return req('GET', '/products/' + encodeURIComponent(handle)); },
    cart: cart,
    quote: function (opts) { if (!lines.length) return Promise.reject(StoreError('Your cart is empty.', 400)); return req('POST', '/quote', payload(opts)); },
    checkout: function (opts) {
      if (!lines.length) return Promise.reject(StoreError('Your cart is empty.', 400));
      var p = payload(opts); p.type = 'mya:checkout';
      try { window.parent.postMessage(p, '*'); } catch (e) { return Promise.reject(StoreError('Checkout could not be opened.', 0)); }
      return Promise.resolve({ handedOff: true });
    },
    money: function (minor, currency) {
      var c = currency || (info && info.currency) || 'INR';
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format((minor || 0) / 100); } catch (e) { return c + ' ' + ((minor || 0) / 100).toFixed(2); }
    }
  });
})();`;

export function storefrontScripts(config: StorefrontConfig): string {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<script>window.__STORE__=${json};</script>\n<script>\n${STORE_SDK_SOURCE}\n</script>`;
}
