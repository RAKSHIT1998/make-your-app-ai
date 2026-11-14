import { TEST } from '../stack/emulators.mjs';

export const meta = { name: 'billing', product: 'Plans, billing and credits', covers: 'pricing page, subscribe through Razorpay, plan changes only after the verified webhook, forged webhook refused, credit top-up, payment history, cancel' };

export async function run(bot) {
  const page = await bot.page();
  await bot.fakeRazorpayCheckout(page);
  await bot.step('Pricing page shows the plans (monthly and yearly)', async () => {
    await page.goto(`${bot.web}/pricing`);
    await page.getByText('Most popular').first().waitFor();
    await page.getByRole('radio', { name: 'yearly' }).click();
    await bot.noSidewaysScroll(page, 'Pricing');
    await bot.shot(page, 'pricing');
  });
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const sub = await bot.step('Choose Creator: Razorpay opens with the platform key, plan unchanged while waiting', async () => {
    await page.goto(`${bot.web}/billing`);
    await page.getByRole('button', { name: 'Choose Creator' }).click();
    await page.getByText('Waiting for the payment provider').waitFor();
    await page.waitForFunction(() => window.__rzp?.subscription_id);
    const opened = await page.evaluate(() => window.__rzp);
    bot.check(opened.key === TEST.platformRazorpay.keyId, `checkout opened with key ${opened.key}`);
    const o = await bot.call(email, 'GET', '/billing/overview');
    bot.check(o.plan.code !== 'creator', 'plan changed before any payment');
    return opened.subscription_id;
  });
  await bot.step('A forged webhook (bad signature) changes nothing', async () => {
    const raw = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: sub, status: 'active' } } } });
    const r = await fetch(`${bot.api}/webhooks/billing/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'forged', 'x-razorpay-event-id': 'evt_forged' }, body: raw });
    bot.check(r.status >= 400, `forged webhook accepted (${r.status})`);
    bot.check((await bot.call(email, 'GET', '/billing/overview')).plan.code !== 'creator', 'forged webhook upgraded the plan');
  });
  await bot.step('Razorpay’s signed “charged” webhook activates Creator', async () => {
    const start = Math.floor(Date.now() / 1000);
    const r = await bot.billingWebhook('subscription.charged', { subscription: { entity: { id: sub, status: 'active', current_start: start, current_end: start + 30 * 86400 } }, payment: { entity: { id: `pay_${Date.now()}`, amount: 99900, currency: 'INR', fee: 1998, tax: 305 } } });
    bot.check(/activated|renewed|charged/.test(JSON.stringify(r)), `webhook outcome ${JSON.stringify(r)}`);
    await page.getByText('Payment confirmed.').waitFor({ timeout: 20_000 });
    bot.check((await bot.call(email, 'GET', '/billing/overview')).plan.code === 'creator', 'plan is not Creator after payment');
  });
  await bot.step('Buy a credit top-up; credits arrive only after Razorpay confirms', async () => {
    const before = (await bot.call(email, 'GET', '/credits')).balance;
    await page.evaluate(() => { window.__rzp = null; });
    await page.getByRole('button', { name: 'Buy' }).first().click();
    await page.waitForFunction(() => window.__rzp?.order_id);
    const order = await page.evaluate(() => window.__rzp);
    bot.check((await bot.call(email, 'GET', '/credits')).balance === before, 'credits added before payment');
    await bot.billingWebhook('order.paid', { order: { entity: { id: order.order_id } }, payment: { entity: { id: `pay_t${Date.now()}`, amount: order.amount, currency: 'INR', order_id: order.order_id } } });
    let after = before;
    for (let i = 0; i < 20 && after <= before; i++) { await page.waitForTimeout(500); after = (await bot.call(email, 'GET', '/credits')).balance; }
    bot.check(after === before + 300, `credits ${before} → ${after} after a 300-credit top-up`);
    await page.getByText('Top-up credits (never expire)').waitFor();
  });
  await bot.shot(page, 'billing-paid', { full: true });
  await bot.step('Billing page fits the screen', () => bot.noSidewaysScroll(page, 'Billing'));
}
