export const meta = { name: 'owner-console', product: 'Owner console (platform admin)', covers: 'hidden from customers (404), overview and analytics, customer search, a feature switched off reaches customers and comes back on, AI routing: add, switch off and remove a route (desktop and phone)' };

export async function run(bot) {
  await bot.step('Customers can’t see the owner console (404, not "forbidden")', async () => {
    const customer = await bot.page({ label: 'customer' });
    const email = await bot.signIn(customer, bot.email('customer'));
    const r = await fetch(`${bot.api}/admin/overview`, { headers: { authorization: `Bearer ${await bot.token(email)}` } });
    bot.check(r.status === 404, `customer got ${r.status} from the admin API`);
    bot.allowConsole(/404/);
    await customer.goto(`${bot.web}/admin`);
    await customer.getByText(/not found|404|doesn’t exist|does not exist/i).first().waitFor();
  });

  const page = await bot.page({ label: 'owner' });
  await bot.step('The platform owner signs in and sees revenue, AI cost and margin', async () => {
    await bot.signIn(page, bot.ownerEmail);
    await page.goto(`${bot.web}/admin`);
    await page.getByText(/MRR/).first().waitFor();
    await page.getByText(/margin/i).first().waitFor();
    await bot.noSidewaysScroll(page, 'Owner console');
    await bot.shot(page, 'overview');
  });

  await bot.step('Analytics and users load from real records', async () => {
    await page.getByRole('tab', { name: 'Analytics' }).click();
    await page.getByText(/Sign-ups|sign-ups/).first().waitFor();
    await page.getByRole('tab', { name: 'Customers' }).click();
    await page.getByPlaceholder('Search email or name').fill(bot.ownerEmail);
    await page.getByPlaceholder('Search email or name').press('Enter');
    await page.getByText(bot.ownerEmail).locator('visible=true').first().waitFor();
  });

  // Voice input is the one switch no other bot relies on (all bots share one platform and run side by side).
  await bot.step('Switching off a feature flag reaches every customer, and switching it on restores it', async () => {
    const flag = async () => (await bot.publicCall('GET', '/flags')).body.voice_input;
    const customer = await bot.page({ label: 'customer' });
    await bot.signIn(customer, bot.email('voice'));
    await customer.goto(`${bot.web}/create`);
    await customer.getByLabel('Describe your idea').waitFor();
    const hadMic = (await customer.getByRole('button', { name: 'Start voice input' }).count()) > 0;
    await page.getByRole('tab', { name: 'Feature flags' }).click();
    const sw = page.getByRole('radiogroup', { name: 'voice_input' });
    await sw.getByRole('radio', { name: 'Off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
    let v = true;
    for (let i = 0; i < 20 && v !== false; i++) { await page.waitForTimeout(500); v = await flag(); }
    bot.check(v === false, 'the public flag list still says voice input is on');
    if (hadMic) {
      await customer.reload();
      await customer.getByLabel('Describe your idea').waitFor();
      await customer.waitForTimeout(1500);
      bot.check(await customer.getByRole('button', { name: 'Start voice input' }).count() === 0, 'customers still see voice input while it is switched off');
    }
    await sw.getByRole('radio', { name: 'On' }).click();
    for (let i = 0; i < 20 && v !== true; i++) { await page.waitForTimeout(500); v = await flag(); }
    bot.check(v === true, 'voice input did not come back on');
  });

  await bot.step('AI routing: add a $0 route, switch it off, remove it', async () => {
    await page.getByRole('tab', { name: 'AI routing' }).click();
    await page.getByText('What customers pay').waitFor();
    await page.getByRole('button', { name: 'Add route' }).last().click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Provider').fill('gemini');
    await d.getByLabel('Model').fill('bot-example-flash');
    await d.getByLabel(/input \$/).fill('0');
    await d.getByLabel(/output \$/).fill('0');
    await d.getByLabel(/Quality/).fill('60');
    await d.getByLabel('Daily request cap').fill('100');
    await d.getByRole('button', { name: 'Save route' }).click();
    await page.getByText('Route saved').waitFor();
    await page.getByRole('button', { name: 'Actions for bot-example-flash' }).first().click();
    await page.getByRole('menuitem', { name: 'Turn off' }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Actions for bot-example-flash' }).first().click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await page.getByText('bot-example-flash').first().waitFor({ state: 'detached' });
  });
}
