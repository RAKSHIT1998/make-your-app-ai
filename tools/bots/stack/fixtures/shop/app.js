const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
let all = [];
let info = null;

function render(list) {
  const grid = $('grid');
  grid.replaceChildren();
  if (!list.length) { $('status').textContent = all.length ? 'No products match your search.' : 'No products yet.'; return; }
  $('status').textContent = '';
  for (const p of list) {
    const v = p.variants.find((x) => x.available) || p.variants[0];
    const card = el('li', null, 'card');
    card.append(el('h3', p.title));
    if (p.description) card.append(el('p', p.description, 'muted'));
    const price = el('p', Store.money(v.priceMinor), 'price');
    if (v.compareAtMinor && v.compareAtMinor > v.priceMinor) price.append(el('span', Store.money(v.compareAtMinor), 'was'));
    card.append(price);
    if (p.variants.length > 1) card.append(el('p', p.variants.map((x) => x.title).join(' · '), 'muted'));
    const add = el('button', v.available ? 'Add to cart' : 'Out of stock');
    add.type = 'button'; add.disabled = !v.available;
    add.addEventListener('click', () => { Store.cart.add(p, v, 1); openCart(); });
    card.append(add);
    grid.append(card);
  }
}

async function refreshTotals() {
  const totals = $('totals');
  $('cart-error').textContent = '';
  if (!Store.cart.count()) { totals.replaceChildren(); $('checkout').disabled = true; return; }
  $('checkout').disabled = false;
  try {
    const q = await Store.quote(opts());
    const rows = [['Subtotal', q.subtotalMinor], ['Discount', -q.discountMinor], ['Delivery', q.shippingMinor], ['Tax', q.taxMinor], ['Total', q.totalMinor]];
    totals.replaceChildren(...rows.filter(([k, v]) => v || k === 'Subtotal' || k === 'Total').flatMap(([k, v]) => [el('dt', k), el('dd', Store.money(v))]));
  } catch (e) { $('cart-error').textContent = e.message; }
}
const opts = () => ({ discountCode: $('code').value.trim() || undefined, shippingId: $('ship').value || undefined });

function renderCart() {
  $('cart-count').textContent = String(Store.cart.count());
  const lines = $('lines');
  lines.replaceChildren();
  for (const l of Store.cart.items()) {
    const row = el('li', null, 'line');
    row.append(el('span', `${l.title}${l.variantTitle ? ' · ' + l.variantTitle : ''}`));
    const q = el('span', null, 'qty');
    const minus = el('button', '−'); minus.type = 'button'; minus.setAttribute('aria-label', `One less ${l.title}`);
    minus.addEventListener('click', () => Store.cart.setQuantity(l.variantId, l.quantity - 1));
    const plus = el('button', '+'); plus.type = 'button'; plus.setAttribute('aria-label', `One more ${l.title}`);
    plus.addEventListener('click', () => Store.cart.setQuantity(l.variantId, l.quantity + 1));
    q.append(minus, el('span', String(l.quantity)), plus);
    row.append(q);
    lines.append(row);
  }
  if (!Store.cart.count()) lines.append(el('li', 'Your cart is empty.', 'muted'));
  refreshTotals();
}
function openCart() { $('cart').hidden = false; }

$('cart-button').addEventListener('click', openCart);
$('cart-close').addEventListener('click', () => { $('cart').hidden = true; });
$('code').addEventListener('change', refreshTotals);
$('ship').addEventListener('change', refreshTotals);
$('search').addEventListener('input', (e) => { const s = e.target.value.toLowerCase(); render(all.filter((p) => p.title.toLowerCase().includes(s))); });
$('checkout').addEventListener('click', () => { Store.checkout(opts()).catch((e) => { $('cart-error').textContent = e.message; }); });
Store.cart.onChange(renderCart);

(async () => {
  try {
    info = await Store.info();
    $('store-name').textContent = info.name;
    document.title = info.name;
    if (info.shipping.length) {
      $('ship-wrap').hidden = false;
      $('ship').replaceChildren(...info.shipping.map((s) => { const o = el('option', `${s.name} · ${Store.money(s.rateMinor)}`); o.value = s.id; return o; }));
    }
    $('status').textContent = 'Loading products…';
    all = await Store.products();
    render(all);
  } catch (e) { $('status').textContent = e.message; }
  renderCart();
})();
