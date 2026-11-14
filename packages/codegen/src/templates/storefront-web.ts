import type { ProjectTemplate } from './types.js';

const j = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * Online store: the AI writes the shop front (plain HTML/CSS/JS); products, stock, prices, discounts, orders and payments
 * live in the platform's commerce engine and are reached only through the injected `Store` object. Payment happens on
 * the platform-hosted checkout, never in generated code. Bump `version` on any change.
 */
export const storefrontWebTemplate: ProjectTemplate = {
  id: 'storefront-web',
  version: 1,
  projectTypes: ['ecommerce'],
  description:
    'An online store front: index.html, style.css, app.js in plain JavaScript. Products, prices, stock, discounts and orders come from the store the owner manages in Business Studio, through the global `Store` object. Checkout and payment happen on a secure checkout page the platform provides.',
  install: ['node', '--version'],
  checks: [{ name: 'syntax', cmd: ['node', '--check', 'app.js'] }],
  preview: { cmd: ['npx', '--yes', 'serve', '-l', '{PORT}', '.'], readyPath: '/' },
  agentGuide: [
    'Files: index.html, style.css, app.js (more .js/.css only if needed, loaded as classic scripts in order before </body>; NEVER type="module", import or export) and storefront.json (keep it as is).',
    'All store data comes ONLY through the global Store object (provided by the platform; never define it, never call fetch/XMLHttpRequest/WebSocket). Every call returns a Promise and throws an Error with a user-friendly .message.',
    'Store.info() → {name, currency, pricesIncludeTax, taxRateBps, shipping:[{id,name,rateMinor,freeOverMinor}]}. Store.products({query?, collection?}) → [product]; Store.product(handle) → product. A product is {id, title, handle, description, images:[url], tags, digital, variants:[{id, title, sku, priceMinor, compareAtMinor, options, available}]}. Money is in minor units (paise/cents): show it with Store.money(minor) and never hard-code prices.',
    'Cart (in memory, per visit): Store.cart.add(product, variant, quantity), Store.cart.setQuantity(variantId, q) (0 removes), Store.cart.remove(variantId), Store.cart.clear(), Store.cart.items() → [{variantId, quantity, title, variantTitle, priceMinor, image}], Store.cart.count(), Store.cart.subtotalMinor(), Store.cart.onChange(cb) → unsubscribe. Store.quote({discountCode?, shippingId?}) → server totals {subtotalMinor, discountMinor, shippingMinor, taxMinor, totalMinor, lines}; show its errors (invalid code, unavailable items) next to the field. Store.checkout({discountCode?, shippingId?}) hands the cart to the secure checkout page (email, address and payment are collected there, never in this code).',
    'Build a real shop: a header with the store name (from Store.info()) and a cart button with the item count; a product grid with image, title, price (and the compare-at price struck through when higher), and an out-of-stock state; a product view with image gallery, description, variant picker (only available variants can be added) and quantity; a cart drawer or page with quantity changes, remove, subtotal, discount code field, shipping choice when shipping options exist, a total from Store.quote(), and a Checkout button that calls Store.checkout(). Search and category/tag filters when there are more than a few products. Loading, empty ("No products yet") and error states everywhere.',
    'If Store.info() fails, show its message as the page (for example "This store is not open yet") instead of a broken layout. Never invent products, prices, reviews, ratings, stock counts or delivery promises: everything shown about products comes from Store. Use clearly-marked placeholder copy only for brand text the owner should replace.',
    'Product images are https links from the catalogue: use them with alt text from the product title; show a neutral placeholder block when a product has no image. No other remote assets (fonts, scripts, styles) — they are blocked.',
    'Use semantic HTML, label every input, keyboard-usable controls with visible focus, and a layout that works from 320px wide. Include <meta name="viewport" content="width=device-width, initial-scale=1"> and a <title>. Escape catalogue text by setting textContent, never innerHTML.',
  ],
  files: {
    'package.json': j({ name: 'generated-store', version: '1.0.0', private: true, scripts: { check: 'node --check app.js' } }),
    'storefront.json': j({ kind: 'storefront', version: 1 }),
    'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Store</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top"><h1 id="store-name">Store</h1><button id="cart-button" type="button">Cart (0)</button></header>
  <main id="app" aria-live="polite"><p>Loading…</p></main>
  <script src="app.js"></script>
</body>
</html>
`,
    'style.css': `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #18181b; background: #fff; }
.top { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid #e4e4e7; }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; list-style: none; padding: 0; }
button { font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid #d4d4d8; background: #18181b; color: #fff; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
`,
    'app.js': `const root = document.getElementById('app');
const cartButton = document.getElementById('cart-button');

function el(tag, text) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; }

Store.cart.onChange(() => { cartButton.textContent = 'Cart (' + Store.cart.count() + ')'; });
cartButton.addEventListener('click', () => {
  Store.checkout().catch((e) => { root.prepend(el('p', e.message)); });
});

Store.info().then((info) => {
  document.getElementById('store-name').textContent = info.name;
  document.title = info.name;
  return Store.products();
}).then((products) => {
  root.textContent = '';
  if (!products.length) { root.append(el('p', 'No products yet.')); return; }
  const list = el('ul'); list.className = 'grid';
  for (const p of products) {
    const v = p.variants.find((x) => x.available) || p.variants[0];
    const li = el('li');
    li.append(el('h2', p.title), el('p', Store.money(v.priceMinor)));
    const add = el('button', v.available ? 'Add to cart' : 'Out of stock');
    add.disabled = !v.available;
    add.addEventListener('click', () => Store.cart.add(p, v, 1));
    li.append(add);
    list.append(li);
  }
  root.append(list);
}).catch((e) => { root.textContent = e.message; });
`,
  },
};
