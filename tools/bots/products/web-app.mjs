export const meta = { name: 'web-app', product: 'Web apps (browser tools)', covers: 'build a browser-only web app with AI, it runs in the sandboxed preview, publish, a visitor opens it' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const id = await bot.step('Create a web app with AI', () => bot.createProject(page, { type: /^Web App/, idea: 'A little browser game-style tool that keeps score while practising reflexes' }));
  await bot.step('It runs in the live preview', async () => {
    const f = await bot.openPreview(page);
    await f.locator('canvas, main, body').first().waitFor({ timeout: 20_000 });
    const html = await page.locator('iframe[title="Live preview"]').getAttribute('sandbox');
    bot.check(html && !html.includes('allow-same-origin'), 'preview iframe is not sandboxed');
  });
  await bot.shot(page, 'preview');
  const slug = await bot.step('Publish it', async () => (await bot.publish(email, id, `Reflex trainer ${Date.now() % 100000}`, 'Practise your reflexes in the browser.', 'other')).slug);
  await bot.step('A visitor opens it on the public page', async () => {
    const v = await bot.page({ label: 'visitor' });
    await v.goto(`${bot.web}/p/${slug}`);
    await v.getByRole('button', { name: /^Play / }).click();
    await v.frameLocator('iframe').first().locator('body').waitFor();
    await bot.noSidewaysScroll(v, 'public page');
  });
}
