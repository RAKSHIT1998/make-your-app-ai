import { TEST } from '../stack/emulators.mjs';

export const meta = { name: 'online-store', product: 'Online stores', covers: 'build a shop front with AI, draft catalogue in preview, go live, shopper cart/discount/delivery, hosted checkout, forged payment refused, order confirmed only by the signed webhook' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new seller', () => bot.signIn(page));
  const id = await bot.step('Create an online store with AI', () => bot.createProject(page, { type: /^Online Store/, idea: 'An online shop for handmade soy candles with a cart, discount codes and delivery across India' }));
  const f = await bot.openPreview(page);
  await bot.step('The new shop is empty until products are added', () => f.getByText('No products yet.').waitFor({ timeout: 20_000 }));

  const store = await bot.step('The project came with its own draft store; the seller adds products', async () => {
    const s = (await bot.call(email, 'GET', '/stores')).find((x) => x.projectId === id);
    bot.check(s && s.status === 'draft', 'no draft store was created with the project');
    await bot.call(email, 'POST', `/stores/${s.id}/products`, { title: 'Lavender & Cedar', description: 'Soy wax, 40 hour burn.', status: 'active', variants: [{ title: '200 g', priceMinor: 64900, compareAtMinor: 79900, inventory: { onHand: 8 } }] });
    await bot.call(email, 'POST', `/stores/${s.id}/products`, { title: 'Kashmiri Kahwa', description: 'Saffron, cardamom and green tea.', status: 'active', variants: [{ title: '200 g', priceMinor: 69900, inventory: { onHand: 5 } }] });
    await bot.call(email, 'POST', `/stores/${s.id}/products`, { title: 'Monsoon Rain', status: 'active', variants: [{ title: '200 g', priceMinor: 59900, inventory: { onHand: 0 } }] });
    return s;
  });

  await bot.step('The preview shows the real draft catalogue; out-of-stock can’t be added', async () => {
    await page.reload();
    const fr = await bot.openPreview(page);
    await fr.getByRole('heading', { name: 'Lavender & Cedar' }).waitFor({ timeout: 20_000 });
    bot.check(await fr.getByRole('button', { name: 'Out of stock' }).isDisabled(), 'an out-of-stock product can be added to the cart');
    const pub = await bot.publicCall('GET', `/storefront/${store.slug}`);
    bot.check(pub.status === 404, 'a draft store is visible to the public');
  });
  await bot.step('Checkout from the preview says the store must go live first', async () => {
    const fr = page.frameLocator('iframe[title="Live preview"]');
    await fr.getByRole('button', { name: 'Add to cart' }).first().click();
    await fr.getByText('Total', { exact: true }).waitFor();
    await fr.getByRole('button', { name: 'Checkout' }).click();
    await page.getByText(/Checkout works once your store is live/).waitFor();
  });
  await bot.shot(page, 'preview-cart');

  await bot.step('Seller goes live: payments, delivery, a discount, active', async () => {
    await bot.call(email, 'PUT', `/stores/${store.id}/payments`, { provider: 'razorpay', ...TEST.storeRazorpay });
    await bot.call(email, 'POST', `/stores/${store.id}/shipping`, { name: 'Standard delivery', rateMinor: 9900, freeOverMinor: 150000 });
    await bot.call(email, 'POST', `/stores/${store.id}/discounts`, { code: 'DIYA10', type: 'percentage', value: 1000 });
    await bot.call(email, 'PATCH', `/stores/${store.id}`, { status: 'active', name: 'Diya Candle Co.' });
  });
  const slug = await bot.step('Publish the shop front', async () => (await bot.publish(email, id, 'Diya Candle Co.', 'Handmade soy candles', 'ecommerce')).slug);

  const sp = await bot.page({ label: 'shopper' });
  await bot.fakeRazorpayCheckout(sp, { pay: true });
  bot.allowConsole(/razorpay\/confirm/);
  const sf = sp.frameLocator('iframe').first();
  const card = (t) => sf.getByRole('listitem').filter({ has: sf.getByRole('heading', { name: t }) });
  await bot.step('A shopper opens the shop on its public page', async () => {
    await sp.goto(`${bot.web}/p/${slug}`);
    await sp.getByRole('button', { name: 'Open Diya Candle Co.' }).click();
    await sf.getByRole('heading', { name: 'Kashmiri Kahwa' }).waitFor({ timeout: 20_000 });
    await bot.noSidewaysScroll(sp, 'live shop');
    await bot.shot(sp, 'live-shop');
  });
  await bot.step('Cart: two of one, one of another; a wrong code is refused, the real one applies', async () => {
    await card('Lavender & Cedar').getByRole('button', { name: 'Add to cart' }).click();
    await sf.getByRole('button', { name: 'One more Lavender & Cedar' }).click();
    await sf.getByRole('button', { name: 'Close cart' }).click();
    await card('Kashmiri Kahwa').getByRole('button', { name: 'Add to cart' }).click();
    await sf.getByLabel('Discount code').fill('NOPE');
    await sf.getByLabel('Discount code').press('Tab');
    await sf.getByText('That discount code is not valid.').waitFor();
    await sf.getByLabel('Discount code').fill('DIYA10');
    await sf.getByLabel('Discount code').press('Tab');
    await sf.getByText('Discount', { exact: true }).waitFor();
  });
  await bot.shot(sp, 'cart');
  const co = await bot.step('Hosted checkout: details, then pay ₹1,797.30 (10% off, free delivery over ₹1,500)', async () => {
    await sf.getByRole('button', { name: 'Checkout' }).click();
    await sp.waitForURL('**/shop/**/checkout**', { timeout: 15_000 });
    await sp.getByLabel('Email').fill('meera@example.com');
    await sp.getByLabel('Full name').fill('Meera Raina');
    await sp.getByLabel('Address').fill('12 Boulevard Road');
    await sp.getByLabel('City').fill('Srinagar');
    await sp.getByLabel('PIN / postal code').fill('190001');
    await bot.noSidewaysScroll(sp, 'checkout');
    const pay = sp.getByRole('button', { name: /^Pay / });
    bot.check((await pay.innerText()).includes('1,797.30'), `wrong total on the Pay button: ${await pay.innerText()}`);
    await bot.shot(sp, 'checkout');
    const resp = sp.waitForResponse((r) => r.url().endsWith('/checkout') && r.request().method() === 'POST');
    await pay.click();
    return (await resp).json();
  });
  await bot.step('A forged payment confirmation is refused: the order stays “waiting”', async () => {
    await sp.waitForURL('**/order/**', { timeout: 15_000 });
    await sp.getByText('Waiting for payment confirmation…').waitFor();
    const o = await bot.call(email, 'GET', `/stores/${store.id}/orders/${co.id}`);
    bot.check(o.status === 'pending_payment', `order became ${o.status} without a real payment`);
  });
  await bot.step('Razorpay’s signed webhook confirms it; the shopper sees “confirmed”', async () => {
    const r = await bot.storeWebhook(store.id, 'payment.captured', { payment: { entity: { id: `pay_${Date.now()}`, order_id: co.payment.razorpayOrderId, amount: co.totalMinor, currency: 'INR' } } });
    bot.check(r.outcome === 'order_paid', `webhook outcome: ${JSON.stringify(r)}`);
    await sp.getByText('Thank you! Your order is confirmed.').waitFor({ timeout: 20_000 });
    await bot.shot(sp, 'confirmed');
  });
}
