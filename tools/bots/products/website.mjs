export const meta = { name: 'website', product: 'Websites', covers: 'build a Next.js website with AI, read its code, change it by chat, version history and restore, health score, source download' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  await bot.step('Home shows credits and a way to start', async () => {
    await page.getByText('Plan & credits').first().waitFor();
    await bot.noSidewaysScroll(page, 'Home');
  });
  const id = await bot.step('Create a website with AI', () => bot.createProject(page, { type: /^Website/, idea: 'A website for my boutique lakeside hotel with rooms, a gallery and WhatsApp enquiries.' }));
  await bot.shot(page, 'built');

  const openFile = async (path) => {
    if (bot.isPhone) await page.getByRole('tab', { name: 'Files' }).click();
    await page.locator(`button[title="${path}"]`).locator('visible=true').first().click();
  };
  await bot.step('The generated code is readable in the builder', async () => {
    await openFile('lib/rooms.ts');
    await page.getByText('export const rooms').first().waitFor();
  });

  await bot.step('Change it by chat: "Add a penthouse room" creates version 2', async () => {
    if (bot.isPhone) await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByLabel('Message the AI').fill('Add a penthouse room');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Added a Penthouse room.').first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500);
    await openFile('lib/rooms.ts');
    await page.getByText("'Penthouse'").first().waitFor();
    const versions = await bot.call(email, 'GET', `/projects/${id}/versions`);
    bot.check(versions.length === 2, `expected 2 versions, found ${versions.length}`);
  });
  await bot.shot(page, 'edited');

  await bot.step('Restore version 1 (creates version 3 with the old content)', async () => {
    await page.getByRole('tab', { name: 'Versions' }).locator('visible=true').first().click();
    await page.getByRole('button', { name: 'Restore' }).locator('visible=true').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
    for (let i = 0; i < 30; i++) {
      const v = await bot.call(email, 'GET', `/projects/${id}/versions`);
      if (v.length === 3) return;
      await page.waitForTimeout(500);
    }
    throw new Error('restoring did not create a new version');
  });

  await bot.step('Health tab gives a score out of 100', async () => {
    await page.getByRole('tab', { name: 'Health' }).locator('visible=true').first().click();
    await page.getByLabel(/^Score \d+ out of 100$/).waitFor({ timeout: 20_000 });
    await bot.noSidewaysScroll(page, 'Health tab');
  });
  await bot.shot(page, 'health');

  await bot.step('Download the source as a .zip', async () => {
    await page.getByRole('tab', { name: 'Versions' }).locator('visible=true').first().click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .zip' }).click()]);
    bot.check(/\.zip$/.test(dl.suggestedFilename()), `download is not a zip: ${dl.suggestedFilename()}`);
  });
}
