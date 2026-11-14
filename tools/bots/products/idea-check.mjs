export const meta = { name: 'idea-check', product: 'Idea check', covers: 'AI assessment of an idea (credit-metered), saved, then handed to Create as a build brief' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const before = (await bot.call(email, 'GET', '/credits')).balance;
  await bot.step('Check an idea: verdict, risks and a first-week plan', async () => {
    await page.goto(`${bot.web}/ideas`);
    await page.getByLabel('Your idea').fill('A neighbourhood tool library where people reserve drills and ladders for a weekend instead of buying them.');
    await page.getByRole('button', { name: 'Check my idea' }).click();
    await page.getByRole('heading', { name: 'Weekend tool library for neighbours' }).waitFor({ timeout: 30_000 });
    await page.getByText(/Damage and liability/).first().waitFor();
    await bot.noSidewaysScroll(page, 'Idea check');
    await bot.shot(page, 'idea');
  });
  await bot.step('It used a few credits (metered, not free-for-all)', async () => {
    const after = (await bot.call(email, 'GET', '/credits')).balance;
    bot.check(after < before, `credits ${before} → ${after}`);
  });
  await bot.step('“Start building this” opens Create with the brief filled in', async () => {
    await page.getByRole('link', { name: 'Start building this' }).click();
    await page.waitForURL('**/create?idea=**');
    bot.check((await page.getByLabel('Describe your idea').inputValue()).includes('tool library'), 'Create is not prefilled');
  });
}
