import { randomUUID } from 'node:crypto';
import { TEST } from '../stack/emulators.mjs';

export const meta = { name: 'business-studio', product: 'Business Studio (stores, orders, payments, delivery)', covers: 'create a store, products, stock, discount, connect payments (wrong then right keys), delivery, go live, real paid orders, fulfil, partial refund, Shiprocket rates/booking/tracking, analytics' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new seller', () => bot.signIn(page));
  const section = async (name) => { await page.getByRole('navigation', { name: 'Store sections' }).getByRole('button', { name, exact: true }).click(); };
  const name = `Kashmir Dry Fruits ${Date.now() % 100000}`;

  const storeId = await bot.step('Create a store', async () => {
    await page.goto(`${bot.web}/stores`);
    await page.getByRole('button', { name: 'New store' }).first().click();
    await page.getByRole('dialog').getByLabel('Store name').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Create store' }).click();
    await page.waitForURL('**/stores/**');
    return page.url().split('/stores/')[1].split(/[/?#]/)[0];
  });
  await bot.step('Add three products with prices and stock', async () => {
    await section('Products');
    for (const [title, variant, price, stock] of [['Premium Walnuts', '500 g', '599', '12'], ['Kashmiri Saffron', '2 g', '899', '3'], ['Mamra Almonds', '250 g', '749', '20']]) {
      await page.getByRole('button', { name: 'Add product' }).first().click();
      const d = page.getByRole('dialog');
      await d.getByLabel('Title').fill(title);
      await d.getByLabel('Variant').fill(variant);
      await d.getByLabel(/^Price/).fill(price);
      await d.getByLabel('Stock').fill(stock);
      await d.getByRole('button', { name: 'Add product' }).click();
      await page.getByText(`${title} added`).waitFor();
    }
    await bot.noSidewaysScroll(page, 'Products');
  });
  await bot.step('Change stock in Inventory', async () => {
    await section('Inventory');
    const box = page.getByLabel('Stock on hand').locator('visible=true').first();
    await box.fill('15'); await box.press('Enter');
    await page.getByText('Stock updated').waitFor();
  });
  await bot.step('Create a 10% discount code', async () => {
    await section('Discounts');
    await page.getByRole('button', { name: 'New code' }).first().click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Code').fill('WELCOME10');
    await d.getByLabel('Percent off').fill('10');
    await d.getByRole('button', { name: 'Create code' }).click();
    await page.getByText('WELCOME10 created').waitFor();
  });
  await bot.step('Payments: wrong keys are refused, the right ones connect', async () => {
    await section('Payments');
    bot.allowConsole(/payments/);
    await page.getByLabel('Key ID').fill('rzp_test_wrong');
    await page.getByLabel('Key secret').fill(TEST.storeRazorpay.keySecret);
    await page.getByLabel('Webhook secret').fill(TEST.storeRazorpay.webhookSecret);
    await page.getByRole('button', { name: 'Verify & connect' }).click();
    await page.getByText(/Authentication failed/).first().waitFor();
    await page.getByLabel('Key ID').fill(TEST.storeRazorpay.keyId);
    await page.getByLabel('Key secret').fill(TEST.storeRazorpay.keySecret);
    await page.getByLabel('Webhook secret').fill(TEST.storeRazorpay.webhookSecret);
    await page.getByRole('button', { name: 'Verify & connect' }).click();
    await page.getByText('Payment provider verified and connected').waitFor();
  });
  await bot.step('Add delivery (free over ₹1,500) and set the store live', async () => {
    await section('Settings');
    await page.getByLabel(/^Rate/).fill('99');
    await page.getByLabel('Free over').fill('1500');
    await page.getByRole('button', { name: 'Add shipping method' }).click();
    await page.getByText('Shipping method added').waitFor();
    await page.getByRole('radio', { name: 'Live' }).click();
    await page.getByText('Store updated').waitFor();
    await bot.noSidewaysScroll(page, 'Settings');
  });
  await bot.shot(page, 'settings');

  const orders = await bot.step('Two shoppers buy; payments are confirmed by signed Razorpay webhooks', async () => {
    const store = (await bot.call(email, 'GET', `/stores/${storeId}`));
    const products = (await bot.publicCall('GET', `/storefront/${store.slug}/products`)).body;
    const v = (t) => products.find((p) => p.title === t).variants[0].id;
    const shipping = (await bot.publicCall('GET', `/storefront/${store.slug}`)).body.shipping[0].id;
    const out = [];
    for (const [items, buyer, code] of [[[{ variantId: v('Premium Walnuts'), quantity: 2 }, { variantId: v('Kashmiri Saffron'), quantity: 1 }], 'asha@example.com', 'WELCOME10'], [[{ variantId: v('Premium Walnuts'), quantity: 1 }], 'vikram@example.com', undefined]]) {
      const r = await bot.publicCall('POST', `/storefront/${store.slug}/checkout`, { checkoutToken: randomUUID() + randomUUID(), email: buyer, items, discountCode: code, shippingId: shipping, shippingAddress: { name: 'Buyer', line1: '12 Boulevard Road', city: 'Srinagar', state: 'Jammu and Kashmir', postalCode: '190001', country: 'IN', phone: '9876543210' } });
      bot.check(r.status === 201 && r.body.payment, `checkout failed: ${JSON.stringify(r.body).slice(0, 200)}`);
      const w = await bot.storeWebhook(storeId, 'payment.captured', { payment: { entity: { id: `pay_${randomUUID().slice(0, 8)}`, order_id: r.body.payment.razorpayOrderId, amount: r.body.totalMinor, currency: 'INR', status: 'captured' } } });
      bot.check(w.outcome === 'order_paid', `webhook: ${JSON.stringify(w)}`);
      out.push(r.body);
    }
    const again = await bot.storeWebhook(storeId, 'payment.captured', { payment: { entity: { id: 'pay_dup', order_id: out[1].payment.razorpayOrderId, amount: out[1].totalMinor, currency: 'INR' } } });
    bot.check(again.outcome !== 'order_paid', 'a repeated webhook paid the order twice');
    return out;
  });
  await bot.step('Fulfil the first order with a tracking number', async () => {
    await section('Orders');
    await page.getByText(`#${orders[0].number}`).locator('visible=true').first().click();
    await page.getByPlaceholder('Tracking number (optional)').fill('DTDC-77812');
    await page.getByRole('button', { name: 'Mark fulfilled' }).click();
    await page.getByText('Marked as fulfilled').waitFor();
  });
  await bot.step('Partially refund the second order (₹100)', async () => {
    await page.keyboard.press('Escape');
    await page.getByText(`#${orders[1].number}`).locator('visible=true').first().click();
    await page.getByLabel('Refund amount').fill('100');
    await page.getByRole('button', { name: 'Refund', exact: true }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Issue refund' }).click();
    await page.getByText('Refund issued').waitFor();
    const o = await bot.call(email, 'GET', `/stores/${storeId}/orders/${orders[1].id}`);
    bot.check(o.status === 'partially_refunded' && o.refundedMinor === 10000, `order after refund: ${o.status}, refunded ${o.refundedMinor}`);
  });
  await bot.shot(page, 'orders');

  await bot.step('Connect Shiprocket (wrong password refused), book the cheapest-first courier, track it', async () => {
    await page.keyboard.press('Escape');
    await section('Extensions');
    await page.getByRole('button', { name: 'Connect Shiprocket' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('API user email').fill(TEST.shiprocket.email);
    await d.getByLabel('API user password').fill('nope');
    await d.getByLabel('Pickup location name').fill('Warehouse');
    await d.getByLabel('Pickup PIN code').fill('110001');
    await d.getByRole('button', { name: 'Verify & connect' }).click();
    await d.getByText(/did not accept/).waitFor();
    await d.getByLabel('API user password').fill(TEST.shiprocket.password);
    await d.getByRole('button', { name: 'Verify & connect' }).click();
    await page.getByText('Pickup: Warehouse · 110001').waitFor();
    await section('Orders');
    await page.getByText(`#${orders[1].number}`).locator('visible=true').first().click();
    const courier = page.getByRole('radiogroup', { name: 'Courier' });
    await courier.waitFor({ timeout: 15_000 });
    bot.check((await courier.getByRole('radio').first().textContent()).includes('Ekart'), 'cheapest courier is not listed first');
    await courier.getByRole('radio', { name: /Blue Dart/ }).click();
    await page.getByRole('button', { name: 'Book delivery' }).click();
    await page.getByText('Pickup scheduled').first().waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Refresh tracking' }).click();
    await page.getByText(/Picked up/).waitFor();
    const o = await bot.call(email, 'GET', `/stores/${storeId}/orders/${orders[1].id}`);
    bot.check(o.fulfillmentStatus === 'fulfilled' && o.trackingNumber, 'booked order is not fulfilled with an AWB');
  });
  await bot.shot(page, 'delivery');
  await bot.step('Analytics add up: 2 paid orders, ₹100 refunded', async () => {
    await page.keyboard.press('Escape');
    await section('Analytics');
    await page.getByText('Gross sales').first().waitFor();
    const a = await bot.call(email, 'GET', `/stores/${storeId}/analytics?days=30`);
    bot.check(a.orders === 2 && a.refundsMinor === 10000, `analytics: ${a.orders} orders, refunds ${a.refundsMinor}`);
    await bot.noSidewaysScroll(page, 'Analytics');
  });
}
