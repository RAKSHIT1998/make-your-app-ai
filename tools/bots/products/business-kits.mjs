export const meta = { name: 'business-kits', product: 'Business software (kits, team-only apps)', covers: 'pick the CRM kit, build a team-only app, staff not on the team are refused, owner adds them in the Dashboard, they sign in and share records, removal locks them out' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a business owner', () => bot.signIn(page));
  await bot.step('Pick the CRM kit: the brief is filled in and Full-stack App is selected', async () => {
    await page.goto(`${bot.web}/create`);
    await page.getByRole('button', { name: /^CRM/ }).click();
    await page.getByText(/Starting from the/).waitFor();
    const brief = await page.getByLabel('Describe your idea').inputValue();
    bot.check(brief.includes('team-only app'), 'the kit brief does not ask for a team-only app');
    bot.check(await page.getByRole('radio', { name: /^Full-stack App/ }).getAttribute('aria-checked') === 'true', 'Full-stack App is not selected');
    await bot.noSidewaysScroll(page, 'Create with a kit');
  });
  const id = await bot.step('Build it', () => bot.createProject(page, { kit: 'crm' }));
  const slug = await bot.step('Publish it', async () => (await bot.publish(email, id, `Acme CRM ${Date.now() % 100000}`, 'Our team’s customer pipeline', 'business')).slug);

  const staff = await bot.page({ label: 'staff' });
  const lf = staff.frameLocator('iframe[sandbox]');
  bot.allowConsole(/appdata\/.*\/auth/);
  await bot.step('A person not on the team can’t create an account', async () => {
    await staff.goto(`${bot.web}/p/${slug}`);
    await staff.getByRole('button', { name: /^Open / }).click();
    await lf.getByRole('button', { name: 'New here? Create an account' }).click({ timeout: 20_000 });
    await lf.getByLabel('Email').fill('ravi@acme.example');
    await lf.getByLabel(/^Password/).fill('staff password 1');
    await lf.getByRole('button', { name: 'Create account' }).click();
    await lf.getByText(/for its team only/).waitFor({ timeout: 10_000 });
  });
  await bot.step('The owner adds them under Team access in the Dashboard', async () => {
    await page.goto(`${bot.web}/projects/${id}/dashboard`);
    await page.getByLabel('Add people by email').fill('ravi@acme.example, sana@acme.example');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('list', { name: 'Team members' }).getByText('ravi@acme.example').waitFor();
    await bot.noSidewaysScroll(page, 'Dashboard');
    await bot.shot(page, 'team-access');
  });
  await bot.step('Now they can sign up and add a shared record', async () => {
    await lf.getByRole('button', { name: 'Create account' }).click();
    await lf.getByRole('heading', { name: 'My tasks' }).waitFor({ timeout: 15_000 });
    await lf.getByText('No tasks yet. Add your first one above.').waitFor({ timeout: 15_000 });
    await lf.getByLabel('New task').fill('Call Mehta Traders about renewal');
    await lf.getByRole('button', { name: 'Add' }).click();
    await lf.getByText('Call Mehta Traders about renewal', { exact: true }).waitFor();
  });
  await bot.step('Removing them signs them out of the app', async () => {
    const item = page.getByRole('list', { name: 'Team members' }).getByRole('button', { name: 'Remove ravi@acme.example' });
    await item.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('list', { name: 'Team members' }).getByText('ravi@acme.example').waitFor({ state: 'detached' });
    const r = await bot.call(email, 'GET', `/projects/${id}/insights/team`);
    bot.check(!JSON.stringify(r).includes('ravi@acme.example'), 'removed member is still listed');
  });
}
