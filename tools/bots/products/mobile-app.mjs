export const meta = { name: 'mobile-app', product: 'Mobile apps (App Studio)', covers: 'build an Expo app with AI, App Studio settings saved into app.json as a new version, invalid ids refused, release checklist, source download' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const id = await bot.step('Create a mobile app with AI', () => bot.createProject(page, { type: /^Mobile App/, idea: 'An app for our café with the menu, opening hours and a way to request a table' }));
  await bot.step('The app code is React Native (Expo) with the AI’s screens', async () => {
    const files = await bot.call(email, 'GET', `/projects/${id}/files`);
    for (const f of ['app.json', 'app/index.tsx', 'app/book.tsx']) bot.check(files.some((x) => x.path === f), `${f} missing`);
  });
  await bot.step('App Studio lists the app; App settings opens from the builder', async () => {
    await page.goto(`${bot.web}/studio/app`);
    await page.getByRole('link', { name: /An app for our café/ }).first().waitFor();
    await bot.noSidewaysScroll(page, 'App Studio list');
    await page.goto(`${bot.web}/projects/${id}`);
    await page.getByRole('button', { name: 'App settings' }).click();
    await page.getByLabel('App name').waitFor();
    await bot.noSidewaysScroll(page, 'App Studio');
  });
  await bot.step('A bad bundle id is refused before saving', async () => {
    await page.getByLabel('iOS bundle identifier').fill('not a bundle id');
    await page.getByText(/bundle identifier/i).nth(1).waitFor();
    bot.check(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), 'Save is allowed with an invalid bundle id');
  });
  await bot.step('Save name, version and ids: a new version with the updated app.json', async () => {
    const before = (await bot.call(email, 'GET', `/projects/${id}/versions`)).length;
    await page.getByLabel('App name').fill('Lakeview Café');
    await page.getByLabel('Version').fill('1.2.0');
    await page.getByLabel('iOS bundle identifier').fill('com.lakeview.cafe');
    await page.getByLabel('Android package').fill('com.lakeview.cafe');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByText('App settings saved as a new version').waitFor();
    const versions = await bot.call(email, 'GET', `/projects/${id}/versions`);
    bot.check(versions.length === before + 1, 'saving did not create a new version');
    const appJson = await bot.call(email, 'GET', `/projects/${id}/file?path=app.json`);
    bot.check(JSON.stringify(appJson).includes('com.lakeview.cafe') && JSON.stringify(appJson).includes('1.2.0'), 'app.json does not contain the new bundle id and version');
  });
  await bot.shot(page, 'app-studio');
  await bot.step('Release checklist and honest build instructions are shown', async () => {
    await page.getByText('Release checklist').waitFor();
    await page.getByText(/Managed iOS and Android builds aren’t connected yet/).waitFor();
  });
  await bot.step('Download the source (.zip)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download source (.zip)' }).click()]);
    bot.check(/\.zip$/.test(dl.suggestedFilename()), 'not a zip');
  });
}
