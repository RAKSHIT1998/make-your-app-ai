export const meta = {
  name: 'password-reset',
  product: 'Forgotten password',
  covers: 'forgot password on the web sign-in page, the emailed link, choosing a new password, old password refused, new one works, expired link, and the phone app asking for a reset link',
};

export async function run(bot) {
  const email = bot.email('reset');
  const page = await bot.page();
  const outbox = async (who) => (await (await fetch(`${bot.authUrl}/__outbox?email=${encodeURIComponent(who)}`)).json()).link;

  await bot.step('Has an account, then forgets the password', async () => {
    await bot.call(email, 'GET', '/me');
    await page.goto(`${bot.web}/login`);
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await page.getByRole('heading', { name: 'Reset your password' }).waitFor();
    bot.check((await page.getByLabel('Password').count()) === 0, 'the reset form still asks for a password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.getByText(/a link to choose a new password is on its way/).waitFor();
    await bot.shot(page, 'reset-requested');
  });

  await bot.step('Opens the emailed link and chooses a new password', async () => {
    const link = await outbox(email);
    bot.check(link?.startsWith(`${bot.web}/reset-password#`), `the reset link points somewhere else: ${link}`);
    const fresh = await bot.page({ label: 'email-link' });
    await fresh.goto(link);
    await fresh.getByRole('heading', { name: 'Choose a new password' }).waitFor({ timeout: 15_000 });
    await fresh.getByLabel('New password').fill('brand-new-pass-1');
    await fresh.getByLabel('Repeat it').fill('brand-new-pass-2');
    await fresh.getByText('The two passwords don’t match.').waitFor();
    bot.check(await fresh.getByRole('button', { name: 'Save new password' }).isDisabled(), 'mismatched passwords can be saved');
    await fresh.getByLabel('Repeat it').fill('brand-new-pass-1');
    await bot.shot(fresh, 'choose-password');
    await fresh.getByRole('button', { name: 'Save new password' }).click();
    await fresh.getByText('Your password has been changed.').waitFor();
    await fresh.waitForURL(/\/home/, { timeout: 15_000 });
  });

  await bot.step('The old password no longer works; the new one does', async () => {
    const other = await bot.page({ label: 'later' });
    await other.goto(`${bot.web}/login`);
    await other.getByLabel('Email').fill(email);
    await other.getByLabel('Password').fill('password123');
    await other.locator('form button[type=submit]').click();
    await other.getByText(/Invalid login credentials/i).waitFor();
    await other.getByLabel('Password').fill('brand-new-pass-1');
    await other.locator('form button[type=submit]').click();
    await other.waitForURL(/\/home/, { timeout: 30_000 });
  });

  await bot.step('A link opened without the recovery part says it has expired', async () => {
    const p = await bot.page({ label: 'stale' });
    await p.goto(`${bot.web}/reset-password`);
    await p.getByRole('heading', { name: 'This link has expired' }).waitFor({ timeout: 15_000 });
    await bot.noSidewaysScroll(p, 'Expired reset link');
  });

  if (bot.isPhone) {
    await bot.step('The phone app sends a reset link that opens the website', async () => {
      const who = bot.email('reset-app');
      const p = await bot.page({ label: 'phone-app' });
      await p.goto(`${bot.phoneApp}/login`);
      await p.getByText('Build anything.').waitFor({ timeout: 60_000 });
      await p.getByRole('button', { name: 'Forgot your password?' }).click();
      await p.getByLabel('Email').fill(who);
      await p.getByRole('button', { name: 'Send reset link' }).click();
      await p.getByText(/a link to choose a new password is on its way/).waitFor();
      bot.check((await outbox(who))?.startsWith(`${bot.web}/reset-password#`), 'the app’s reset link does not open the website');
      await bot.shot(p, 'app-reset');
    });
  }
}
