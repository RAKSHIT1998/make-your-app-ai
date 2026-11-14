export const meta = { name: 'owner-dashboard', product: 'Owner Dashboard (per project)', covers: 'visitors, app users and records from real activity, close sign-ups, pause and resume the live app, CSV export' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const id = await bot.step('Build a full-stack app', () => bot.createProject(page, { type: /^Full-stack App/, idea: 'A to-do app where each person signs up and keeps their own private task list' }));
  const slug = await bot.step('Publish it', async () => (await bot.publish(email, id, `Taskly dash ${Date.now() % 100000}`, 'Tasks with accounts', 'saas')).slug);

  const live = await bot.page({ label: 'live user' });
  const lf = live.frameLocator('iframe[sandbox]');
  await bot.step('A real visitor signs up and adds a task', async () => {
    await live.goto(`${bot.web}/p/${slug}`);
    await live.getByRole('button', { name: /^Open / }).click();
    await lf.getByRole('button', { name: 'New here? Create an account' }).click({ timeout: 20_000 });
    await lf.getByLabel('Email').fill('dev@example.com');
    await lf.getByLabel(/^Password/).fill('visitor pass 1');
    await lf.getByRole('button', { name: 'Create account' }).click();
    await lf.getByRole('button', { name: 'Sign out' }).waitFor();
    await lf.getByLabel('New task').fill('Renew passport');
    await lf.getByRole('button', { name: 'Add' }).click();
    await lf.getByText('Renew passport', { exact: true }).waitFor();
  });
  await bot.step('Dashboard shows 1 visitor, 1 app user, 1 record', async () => {
    await page.goto(`${bot.web}/projects/${id}/dashboard`);
    const d = await bot.call(email, 'GET', `/projects/${id}/insights?days=30`);
    bot.check(d.visitors.total >= 1, `visitors ${d.visitors.total}`);
    bot.check(d.appUsers.total === 1, `app users ${d.appUsers.total}`);
    bot.check(d.data.total === 1, `records ${d.data.total}`);
    await page.getByText('Total accounts').waitFor();
    await bot.noSidewaysScroll(page, 'Dashboard');
    await bot.shot(page, 'dashboard', { full: true });
  });
  bot.allowConsole(/appdata/);
  await bot.step('Close sign-ups: a new person is refused, existing users still sign in', async () => {
    await page.getByRole('checkbox', { name: /Allow new sign-ups/ }).click();
    await page.waitForTimeout(800);
    const c = await bot.call(email, 'GET', `/projects/${id}/insights?days=7`);
    bot.check(c.controls.signupsOpen === false, 'sign-ups still open');
    const v2 = await bot.page({ label: 'second visitor' });
    await v2.goto(`${bot.web}/p/${slug}`);
    await v2.getByRole('button', { name: /^Open / }).click();
    const f2 = v2.frameLocator('iframe[sandbox]');
    await f2.getByRole('button', { name: 'New here? Create an account' }).click({ timeout: 20_000 });
    await f2.getByLabel('Email').fill('late@example.com');
    await f2.getByLabel(/^Password/).fill('visitor pass 2');
    await f2.getByRole('button', { name: 'Create account' }).click();
    await f2.getByText(/New sign-ups are closed/).first().waitFor({ timeout: 10_000 });
  });
  await bot.step('Pause the app: the live app goes offline without losing data; resume brings it back', async () => {
    await page.getByRole('button', { name: 'Pause app' }).click();
    const dlg = page.getByRole('dialog');
    if (await dlg.count()) await dlg.getByRole('button', { name: /Pause/ }).click();
    await page.getByRole('button', { name: 'Resume app' }).waitFor();
    const play = (await bot.publicCall('GET', `/showcase/${slug}/play`)).body;
    const key = /\/api\/v1\/appdata\/([^"'/]+)/.exec(play.html)?.[1];
    const r = await bot.publicCall('GET', `/appdata/${key}/auth/me`);
    bot.check(r.status === 503, `paused app answered ${r.status}`);
    await page.getByRole('button', { name: 'Resume app' }).click();
    await page.getByRole('button', { name: 'Pause app' }).waitFor();
    const d = await bot.call(email, 'GET', `/projects/${id}/insights?days=7`);
    bot.check(d.data.total === 1, 'data changed while paused');
  });
  await bot.step('Export app users as CSV', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).first().click()]);
    const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
    bot.check(text.includes('dev@example.com'), 'CSV does not contain the app user');
  });
}
