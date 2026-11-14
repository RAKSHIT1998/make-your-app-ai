export const meta = { name: 'site-import', product: 'Start from your current website', covers: 'import needs the ownership tick, a site that refuses reading shows the reason, a real import fills the Create box with the owner’s own words and the site name, then the AI builds it' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));

  await bot.step('Open “Start from your current website” on Create; Import waits for the ownership tick', async () => {
    await page.goto(`${bot.web}/create`);
    await page.getByRole('button', { name: 'Start from your current website' }).click();
    const form = page.getByRole('form', { name: 'Start from your current website' });
    await form.getByLabel('Your website address').fill('closed.example');
    bot.check(await form.getByRole('button', { name: 'Import' }).isDisabled(), 'Import works without confirming ownership');
    await form.getByLabel(/This is my website/).check();
    bot.check(!(await form.getByRole('button', { name: 'Import' }).isDisabled()), 'Import stays disabled after confirming ownership');
  });

  await bot.step('A site whose robots.txt refuses reading shows that reason (nothing is invented)', async () => {
    bot.allowConsole(/422/);
    const form = page.getByRole('form', { name: 'Start from your current website' });
    await form.getByRole('button', { name: 'Import' }).click();
    await form.getByText(/robots\.txt does not allow it/).waitFor();
  });

  await bot.step('Importing their own site fills the description with their real content', async () => {
    const form = page.getByRole('form', { name: 'Start from your current website' });
    await form.getByLabel('Your website address').fill('kashmirwalnut.example');
    await form.getByRole('button', { name: 'Import' }).click();
    await page.getByText(/Imported 4 pages from/).waitFor();
    await page.getByText(/1 skipped/).waitFor();
    const idea = await page.getByLabel('Describe your idea').inputValue();
    for (const fact of ['Current site: https://kashmirwalnut.example/', 'Snow-white kernels, 500 g — ₹899', '+91 94190 12345', 'Do not invent prices']) {
      bot.check(idea.includes(fact), `the description is missing “${fact}”`);
    }
    await bot.noSidewaysScroll(page, 'Create after import');
    await bot.shot(page, 'imported');
  });

  await bot.step('Build it: the project is named after the site and keeps the imported brief', async () => {
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const planFirst = (await dialog.getByRole('button', { name: 'Draft plan' }).count()) > 0;
    await dialog.getByRole('button', { name: /^(Draft plan|Generate project)$/ }).click();
    await page.waitForURL('**/projects/**', { timeout: 30_000 });
    const id = page.url().split('/projects/')[1].split(/[/?#]/)[0];
    if (planFirst) await page.getByRole('button', { name: 'Build this plan' }).click({ timeout: 60_000 });
    await page.getByText(/Saved version/).first().waitFor({ timeout: 120_000 });
    const p = await bot.call(email, 'GET', `/projects/${id}`);
    bot.check(p.name === 'Kashmir Walnut Co.', `project name is “${p.name}”`);
    bot.check((p.description ?? '').includes('Kashmir Walnut Co.'), 'the project lost the imported description');
  });
}
