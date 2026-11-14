export const meta = { name: 'fullstack-app', product: 'Full-stack apps', covers: 'build an app with accounts and a database, sign up / add / complete / delete in the preview, wrong password, Data tab, publish, a live user with separate data' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const id = await bot.step('Create a full-stack app with AI', () => bot.createProject(page, { type: /^Full-stack App/, idea: 'A to-do app where each person signs up and keeps their own private task list with priorities' }));
  const f = await bot.step('Open the app in the preview', async () => {
    const fr = await bot.openPreview(page);
    await page.getByText(/test accounts and test data/).waitFor();
    return fr;
  });

  await bot.step('Sign up inside the app', async () => {
    await f.getByRole('button', { name: 'New here? Create an account' }).click({ timeout: 20_000 });
    await f.getByLabel('Email').fill('ann@example.com');
    await f.getByLabel(/^Password/).fill('correct horse 1');
    await f.getByRole('button', { name: 'Create account' }).click();
    await f.getByRole('heading', { name: 'My tasks' }).waitFor({ timeout: 15_000 });
    await f.getByText('No tasks yet. Add your first one above.').waitFor({ timeout: 15_000 });
  });
  await bot.step('Add three tasks, complete one, delete one', async () => {
    for (const [t, p] of [['Ship the landing page', 'high'], ['Call the bank', 'normal'], ['Water the plants', 'low']]) {
      await f.getByLabel('New task').fill(t);
      await f.getByLabel('Priority').selectOption(p);
      await f.getByRole('button', { name: 'Add' }).click();
      await f.getByText(t, { exact: true }).waitFor({ timeout: 10_000 });
    }
    await f.getByLabel('Mark "Call the bank" done').check();
    await f.getByText('2 open').waitFor({ timeout: 10_000 });
    await f.getByRole('button', { name: 'Delete "Water the plants"' }).click();
    await f.getByText('Water the plants', { exact: true }).waitFor({ state: 'detached', timeout: 10_000 });
  });
  await bot.shot(page, 'preview-app');
  await bot.step('Sign out; a wrong password is refused, the right one gets the tasks back', async () => {
    await f.getByRole('button', { name: 'Sign out' }).click();
    await f.getByLabel('Email').fill('ann@example.com');
    await f.getByLabel(/^Password/).fill('wrong password 1');
    await f.getByRole('button', { name: 'Sign in' }).click();
    await f.getByText('Wrong email or password.').waitFor();
    await f.getByLabel(/^Password/).fill('correct horse 1');
    await f.getByRole('button', { name: 'Sign in' }).click();
    await f.getByText('Ship the landing page', { exact: true }).waitFor({ timeout: 10_000 });
  });

  await bot.step('The Data tab shows the real records, access rules and the account', async () => {
    await page.getByRole('tab', { name: /^Data/ }).locator('visible=true').first().click();
    await page.getByRole('cell', { name: 'Ship the landing page' }).waitFor({ timeout: 15_000 });
    await page.getByText('Read: only its creator').waitFor();
    await page.getByRole('tab', { name: /Accounts/ }).click();
    await page.getByText('ann@example.com').waitFor();
    await bot.noSidewaysScroll(page, 'Data tab');
  });
  await bot.shot(page, 'data');

  const slug = await bot.step('Publish the app', async () => (await bot.publish(email, id, `Taskly ${bot.device} ${Date.now() % 100000}`, 'Private task lists with accounts', 'saas')).slug);
  await bot.step('A real user signs up in the live app (same email, separate account and data)', async () => {
    const v = await bot.page({ label: 'live user' });
    await v.goto(`${bot.web}/p/${slug}`);
    await v.getByRole('button', { name: /^Open / }).click();
    const lf = v.frameLocator('iframe[sandbox]');
    await lf.getByRole('button', { name: 'New here? Create an account' }).click({ timeout: 20_000 });
    await lf.getByLabel('Email').fill('ann@example.com');
    await lf.getByLabel(/^Password/).fill('live password 9');
    await lf.getByRole('button', { name: 'Create account' }).click();
    await lf.getByText('No tasks yet. Add your first one above.').waitFor({ timeout: 15_000 });
    await lf.getByLabel('New task').fill('First real task');
    await lf.getByRole('button', { name: 'Add' }).click();
    await lf.getByText('First real task', { exact: true }).waitFor({ timeout: 10_000 });
    await bot.noSidewaysScroll(v, 'live app page');
    await bot.shot(v, 'live-app');
  });
  await bot.step('The owner sees live data separately from preview data', async () => {
    await page.getByRole('radio', { name: 'Live' }).click();
    await page.getByRole('tab', { name: /tasks/ }).click();
    await page.getByRole('cell', { name: 'First real task' }).waitFor({ timeout: 15_000 });
    bot.check(await page.getByRole('cell', { name: 'Ship the landing page' }).count() === 0, 'preview data shows up in live data');
  });
}
