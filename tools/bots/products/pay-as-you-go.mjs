export const meta = { name: 'pay-as-you-go', product: 'Pay as you go (saved card, Premium AI)', covers: 'add a card through a Razorpay card mandate, nothing unlocks until the bank confirms it, Premium AI, monthly cap, switch off and on' };

export async function run(bot) {
  const page = await bot.page();
  await bot.fakeRazorpayCheckout(page);
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const order = await bot.step('Add a card with a ₹2,000 monthly cap: Razorpay opens a card mandate, nothing unlocks yet', async () => {
    await page.goto(`${bot.web}/billing`);
    const card = page.locator('#payg');
    await card.getByText('Save a card to unlock').waitFor();
    await card.getByLabel('Monthly cap').fill('2000');
    await card.getByRole('button', { name: 'Add card' }).click();
    await page.waitForFunction(() => window.__rzp?.order_id);
    const o = await page.evaluate(() => window.__rzp);
    bot.check(o.recurring === 1 && !!o.customer_id, `checkout opened without a card mandate: ${JSON.stringify(o)}`);
    bot.check(o.amount === 100, `card check of ${o.amount} paise`);
    await card.getByText('Waiting for your bank').waitFor();
    const v = await bot.call(email, 'GET', '/billing/payg');
    bot.check(v.status === 'pending' && !v.active, `unlocked before the bank confirmed (${v.status})`);
    const est = await bot.call(email, 'GET', '/generations/estimate');
    bot.check(est.spendable === est.balance, 'spending past credits allowed before confirmation');
    return o;
  });
  await bot.step('The bank confirms the mandate: pay-as-you-go turns on by itself', async () => {
    const pay = { id: `pay_c${Date.now()}`, amount: 100, currency: 'INR', order_id: order.order_id, customer_id: order.customer_id, token_id: 'token_bot_1', card: { network: 'Visa', last4: '4242' } };
    await bot.billingWebhook('payment.captured', { payment: { entity: pay } });
    const r = await bot.billingWebhook('token.confirmed', { token: { entity: { id: 'token_bot_1', customer_id: order.customer_id } } });
    bot.check(r.outcome === 'payg_activated', `token webhook outcome ${JSON.stringify(r)}`);
    const card = page.locator('#payg');
    await card.getByText('Visa •••• 4242').waitFor({ timeout: 20_000 });
    await card.getByText('On', { exact: true }).waitFor();
    const est = await bot.call(email, 'GET', '/generations/estimate');
    bot.check(est.payg.active && est.spendable > est.balance && est.maxCreditsPerRun >= 300, `estimate after card: ${JSON.stringify(est)}`);
  });
  await bot.step('Switch on Premium AI and lower the cap', async () => {
    const card = page.locator('#payg');
    const saved = () => page.waitForResponse((r) => r.url().includes('/billing/payg/settings') && r.request().method() === 'POST');
    await Promise.all([saved(), card.getByLabel('Premium AI for builds').check()]);
    await card.getByLabel('Monthly cap (INR)').fill('1500');
    const [res] = await Promise.all([saved(), card.getByRole('button', { name: 'Save cap' }).click()]);
    bot.check(res.ok(), `saving the cap answered ${res.status()}`);
    await bot.waitForToasts(page);
    const v = await bot.call(email, 'GET', '/billing/payg');
    bot.check(v.premiumAi === true && v.monthlyCapMinor === 150_000, `settings not saved: ${JSON.stringify({ premiumAi: v.premiumAi, cap: v.monthlyCapMinor })}`);
  });
  await bot.step('Switch it off (with a confirmation), then back on', async () => {
    const card = page.locator('#payg');
    await card.getByRole('button', { name: 'Switch off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Switch off' }).click();
    await card.getByRole('button', { name: 'Switch back on' }).waitFor();
    const off = await bot.call(email, 'GET', '/billing/payg');
    bot.check(off.status === 'disabled' && !off.premiumAi, `after switching off: ${off.status}`);
    await card.getByRole('button', { name: 'Switch back on' }).click();
    await card.getByRole('button', { name: 'Switch off' }).waitFor();
  });
  await bot.shot(page, 'payg', { full: true });
  await bot.step('Billing page fits the screen', () => bot.noSidewaysScroll(page, 'Billing'));
}
