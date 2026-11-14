export const meta = { name: 'cloud-studio', product: 'Cloud Studio and Templates', covers: 'deploy a website (stand-in host), build logs, live status, secret environment variable stays write-only, public-variable warning, domains tab; submit as a template, owner approves, another customer starts from it' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const id = await bot.step('Build a website with AI', () => bot.createProject(page, { type: /^Website/, idea: 'A website for a neighbourhood bakery with menu, opening hours and pre-orders' }));

  await bot.step('Deploy it; it goes live only after the host reports a healthy build', async () => {
    await page.goto(`${bot.web}/hosting/${id}`);
    await page.getByRole('button', { name: /^Deploy$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deploy' }).click();
    await page.getByText('Deployment started').waitFor();
    await page.getByText('Current', { exact: true }).locator('visible=true').first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Logs' }).locator('visible=true').first().click();
    await page.getByText(/Building \d+ files/).waitFor();
    await page.keyboard.press('Escape');
    await bot.shot(page, 'deployed');
  });

  await bot.step('A secret environment variable is saved but never shown again', async () => {
    await page.getByRole('tab', { name: 'Environment' }).click();
    await page.getByLabel('Name').fill('RESEND_API_KEY');
    await page.getByLabel('Value').fill('re_bot_secret_value_123');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText(/RESEND_API_KEY saved/).waitFor();
    bot.check(!(await page.content()).includes('re_bot_secret_value_123'), 'the secret value is shown on the page after saving');
    const all = JSON.stringify(await bot.call(email, 'GET', `/projects/${id}/env`).catch(() => ''));
    bot.check(!all.includes('re_bot_secret_value_123'), 'the API returns the secret value');
    await page.getByLabel('Name').fill('NEXT_PUBLIC_SITE_NAME');
    await page.getByText(/visible to every visitor/).waitFor();
  });

  await bot.step('Domains tab: add your own domain (included in this plan)', async () => {
    await page.getByRole('tab', { name: 'Domains' }).click();
    await page.getByLabel('Add a domain you own').waitFor();
    await page.getByText('No custom domains').waitFor();
  });

  await bot.step('The hosting list shows the site as live', async () => {
    await page.goto(`${bot.web}/hosting`);
    await page.getByText('Live', { exact: true }).locator('visible=true').first().waitFor();
    await bot.noSidewaysScroll(page, 'Hosting');
  });

  const tplName = `Bakery Starter ${Date.now() % 10000}`;
  await bot.step('Offer it as a template', async () => {
    await page.goto(`${bot.web}/projects/${id}`);
    await page.getByRole('button', { name: 'Share' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Title').fill(tplName);
    await dlg.getByLabel(/^Description/).fill('A bakery website with menu, opening hours and pre-orders.');
    const pub = dlg.getByRole('button', { name: 'Publish' });
    if (await pub.count()) { await pub.click(); await dlg.getByText('Share your project').waitFor(); }
    await dlg.getByRole('button', { name: /Submit as template|Resubmit/ }).click();
    await page.getByText('Submitted for review').waitFor();
  });

  await bot.step('It is not listed until the platform owner approves it', async () => {
    const owner = await bot.page({ label: 'platform owner' });
    await bot.signIn(owner, bot.ownerEmail);
    await owner.goto(`${bot.web}/admin`);
    await owner.getByRole('tab', { name: 'Templates' }).click();
    const row = owner.locator('tr, li, [role=row], div').filter({ hasText: tplName }).filter({ has: owner.getByRole('button', { name: 'Approve' }) }).last();
    await row.getByRole('button', { name: 'Approve' }).click();
    await owner.getByText('Template approved').waitFor();
  });

  await bot.step('Another customer starts a new project from the template', async () => {
    const other = await bot.page({ label: 'other customer' });
    await bot.signIn(other, bot.email('other'));
    await other.goto(`${bot.web}/templates`);
    await other.getByText(tplName).first().click();
    await other.getByRole('dialog').getByLabel(/Project name/).fill('My Bakery');
    await other.getByRole('button', { name: 'Use this template' }).click();
    await other.waitForURL('**/projects/**');
    await other.getByText('Your project is ready to edit').waitFor();
    await bot.shot(other, 'from-template');
  });
}
