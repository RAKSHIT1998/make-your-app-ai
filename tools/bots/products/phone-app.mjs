export const meta = {
  name: 'phone-app',
  product: 'iOS and Android app',
  devices: ['phone'],
  covers: 'the store app (same code, built for the browser): sign in, home, create a game plan-first, build from the plan, files, versions, Ask mode, publish, Explore, like, report and hide a creator, plan and usage, profile, dark mode, owner overview and kill switches, delete account',
};

export async function run(bot) {
  const app = bot.phoneApp;
  const email = bot.email('phone');
  const page = await bot.page();
  const tab = (name) => page.getByRole('tab', { name }).or(page.getByRole('link', { name })).first();

  // Someone else's game, built through the API while this customer signs in, so there is something to like, report and hide.
  const other = bot.email('phone-other');
  const otherTitle = `Lantern Run ${Date.now().toString(36)}`;
  const otherId = (await bot.call(other, 'POST', '/projects', { name: otherTitle, type: 'game' })).id;
  await bot.call(other, 'PATCH', '/me', { displayName: 'Other Maker', handle: `other-${Date.now().toString(36)}` });
  await bot.call(other, 'POST', `/projects/${otherId}/generations`, { prompt: 'A lantern runner game with jumps and coins.' });

  await bot.step('Signs in on the phone app', async () => {
    await page.goto(`${app}/login`);
    await page.getByText('Build anything.').waitFor({ timeout: 60_000 });
    await bot.shot(page, 'login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.getByText(/^Good (morning|afternoon|evening)/).waitFor({ timeout: 30_000 });
    await page.getByText('Credits', { exact: true }).waitFor();
    await bot.noSidewaysScroll(page, 'Home');
    await bot.shot(page, 'home');
  });

  let projectUrl;
  await bot.step('Describes a game, reviews the plan and builds it', async () => {
    await page.getByLabel('Create a project').click();
    await page.getByRole('radio', { name: 'Game' }).click();
    await page.getByLabel('Your idea').fill('A neon breakout game with power-ups, three lives and touch controls for phones.');
    await page.getByRole('button', { name: 'Draft the plan' }).first().click();
    await bot.shot(page, 'create-confirm');
    await page.getByRole('button', { name: 'Draft the plan' }).last().click();
    await page.waitForURL('**/project/**', { timeout: 30_000 });
    projectUrl = page.url();
    await page.getByRole('button', { name: 'Build this plan' }).waitFor({ timeout: 60_000 });
    await page.getByLabel('Who are your main customers?').fill('Teenagers on their phones');
    await bot.shot(page, 'plan');
    await page.getByRole('button', { name: 'Build this plan' }).click();
    await page.getByText('Done. A new version is saved.').waitFor({ timeout: 120_000 });
    await bot.noSidewaysScroll(page, 'Project chat');
    await bot.shot(page, 'built');
  });

  await bot.step('Reads the files and the version history', async () => {
    await page.getByRole('tab', { name: 'Files' }).click();
    await page.getByLabel('Open app.js').click();
    await page.getByText(/function|const|let/).first().waitFor();
    await bot.shot(page, 'file');
    await page.getByLabel('All files').click();
    await page.getByRole('tab', { name: 'Versions' }).click();
    await page.getByText('Current').waitFor();
  });

  await bot.step('Asks a question without changing anything', async () => {
    await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByRole('button', { name: 'Ask' }).click();
    await page.getByLabel('Message').fill('How fast does the ball get on later levels?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/gets about 8% faster/).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Use this as a change' }).click();
    bot.check((await page.getByLabel('Message').inputValue()).includes('20% slower'), 'the suggested change did not fill the message box');
    await bot.shot(page, 'ask');
  });

  await bot.step('Publishes it from the Share tab', async () => {
    await page.getByRole('tab', { name: 'Share' }).click();
    await page.getByLabel('Public title').fill('Neon Breakout Phone');
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Public', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Share link' }).waitFor();
    const pub = await bot.call(email, 'GET', `/projects/${projectUrl.split('/project/')[1]}/publishing`);
    bot.check(pub.visibility === 'public' && pub.slug, 'the project is not public on the server');
    await bot.shot(page, 'published');
  });

  await bot.step('Likes, reports and hides another creator in Explore', async () => {
    for (let i = 0; i < 60; i++) {
      const runs = await bot.call(other, 'GET', `/projects/${otherId}/generations`);
      if (runs.some((r) => r.status === 'succeeded')) break;
      bot.check(!runs.some((r) => r.status === 'failed'), 'the other creator\'s build failed');
      await page.waitForTimeout(1000);
    }
    await bot.call(other, 'PUT', `/projects/${otherId}/publishing`, { visibility: 'public', publicTitle: otherTitle, publicDescription: 'Run, jump and collect coins.' });
    await page.goto(`${app}/explore`);
    await page.getByRole('tab', { name: 'New' }).click();
    await page.getByText(otherTitle).first().waitFor({ timeout: 30_000 });
    await page.getByText('Neon Breakout Phone').first().waitFor();
    await bot.noSidewaysScroll(page, 'Explore');
    await bot.shot(page, 'explore');
    await page.getByLabel(new RegExp(`^${otherTitle} by`)).first().click();
    await page.getByRole('heading', { name: otherTitle }).waitFor();
    await page.getByRole('button', { name: 'Like' }).click();
    await page.getByRole('button', { name: 'Unlike' }).waitFor();
    await page.getByLabel('More').click();
    await page.getByRole('button', { name: 'Report this project' }).click();
    await page.getByRole('button', { name: 'Spam or misleading' }).click();
    await page.getByRole('button', { name: 'Send report' }).click();
    await page.getByText(/Thanks/).first().waitFor();
    await bot.shot(page, 'reported');
    await page.getByLabel('More').click();
    await page.getByRole('button', { name: /^Hide projects by Other Maker/ }).click();
    await page.getByRole('tab', { name: 'New' }).waitFor({ timeout: 15_000 });
    await page.getByText('Neon Breakout Phone').first().waitFor();
    bot.check((await page.getByText(otherTitle).count()) === 0, 'the hidden creator still shows in Explore');
  });

  await bot.step('Checks plan and usage, edits the profile and switches to dark mode', async () => {
    await page.goto(`${app}/account`);
    await page.getByRole('button', { name: 'Plan and usage' }).click();
    await page.getByText('Credits left', { exact: true }).waitFor();
    await page.getByText('AI building').first().waitFor();
    await bot.noSidewaysScroll(page, 'Plan and usage');
    await bot.shot(page, 'plan-usage');
    await page.goto(`${app}/profile`);
    await page.getByLabel('Display name').fill('Phone Maker');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Profile saved').waitFor();
    const me = await bot.call(email, 'GET', '/me');
    bot.check(me.displayName === 'Phone Maker', 'display name not saved');
    await page.goto(`${app}/account`);
    await page.getByRole('tab', { name: 'Dark' }).click();
    // The first painted background behind the Account screen.
    const bg = await page.evaluate(() => {
      for (let el = document.querySelector('[data-testid="account"]'); el; el = el.parentElement) {
        const b = getComputedStyle(el).backgroundColor;
        if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b;
      }
      return 'none';
    });
    bot.check(bg === 'rgb(10, 10, 9)', `dark mode background is ${bg}`);
    await bot.shot(page, 'account-dark');
    await page.getByRole('tab', { name: 'Automatic' }).click();
  });

  await bot.step('The owner sees the business overview and kill switches on the phone', async () => {
    const owner = await bot.page({ label: 'owner' });
    await owner.goto(`${app}/login`);
    await owner.getByLabel('Email').fill(bot.ownerEmail);
    await owner.getByLabel('Password', { exact: true }).fill('password123');
    await owner.getByRole('button', { name: 'Sign in' }).last().click();
    await owner.getByText(/^Good (morning|afternoon|evening)/).waitFor({ timeout: 30_000 });
    await owner.goto(`${app}/owner`);
    await owner.getByText('MRR').waitFor();
    await owner.getByText('AI cost').waitFor();
    await bot.shot(owner, 'owner-overview');
    await owner.goto(`${app}/owner/flags`);
    await owner.getByLabel('Voice input').waitFor();
    await bot.shot(owner, 'owner-flags');
  });

  await bot.step('Deletes the account from the app', async () => {
    await page.goto(`${app}/delete-account`);
    await page.getByText('What will be deleted').waitFor();
    await bot.shot(page, 'delete-account');
    await page.getByLabel(`Type ${email} to confirm`).fill(email);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('button', { name: 'Delete account' }).last().click();
    await page.getByText('Build anything.').waitFor({ timeout: 30_000 });
    const r = await fetch(`${bot.api}/me`, { headers: { authorization: `Bearer ${await bot.token(email)}` } });
    bot.check(r.status === 403, `the deleted account still works (${r.status})`);
  });
}
