export const meta = { name: 'community', product: 'Explore and community (publish, invite, like, comment, collections, follow, remix)', covers: 'publish from the Share panel, logged-out Explore and project page, invite link sign-up, like, comment and creator reply, save to a public collection, follow and Following feed, Remix with AI, referral waits for a first payment' };

export async function run(bot) {
  const page = await bot.page({ label: 'creator' });
  const creator = await bot.step('Sign in as a creator', () => bot.signIn(page, bot.email('creator')));
  const id = await bot.step('Build a website with AI', () => bot.createProject(page, { type: /^Website/, idea: 'A website for a boutique lakeside homestay with rooms, a photo gallery and WhatsApp enquiries' }));
  const title = `Lakeside Homestay ${Date.now() % 100000}`;

  const slug = await bot.step('Publish it from the Share panel', async () => {
    await page.getByRole('button', { name: 'Share' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Title').fill(title);
    await dlg.getByLabel(/^Description/).fill('A calm homestay on the water, with rooms, a gallery and quick WhatsApp enquiries.');
    await dlg.getByRole('combobox', { name: /Category/ }).selectOption('business');
    await dlg.getByRole('button', { name: 'Publish' }).click();
    await dlg.getByText('Share your project').waitFor();
    await bot.shot(page, 'published');
    const p = await bot.call(creator, 'GET', `/projects/${id}/publishing`);
    bot.check(p.visibility === 'public' && p.slug, 'project has no public address after publishing');
    return p.slug;
  });

  await bot.step('A visitor (not signed in) finds it on Explore and opens its page', async () => {
    const visitor = await bot.page({ label: 'visitor' });
    await visitor.goto(`${bot.web}/explore`);
    await visitor.getByLabel(/Search/).first().fill(title);
    await visitor.getByText(title).first().click({ timeout: 20_000 });
    await visitor.waitForURL(`**/p/${slug}`);
    await visitor.getByRole('button', { name: /Remix with AI/ }).waitFor();
    await bot.noSidewaysScroll(visitor, 'the public project page');
    await bot.shot(visitor, 'public-page');
  });

  const code = await bot.step('The creator has an invite link', async () => {
    const r = await bot.call(creator, 'GET', '/referrals');
    const c = r.code ?? r.referralCode;
    bot.check(typeof c === 'string' && c.length >= 6, 'no invite code');
    return c;
  });

  const friendPage = await bot.page({ label: 'friend' });
  const friend = await bot.step('A friend signs up through the invite link', async () => {
    await friendPage.goto(`${bot.web}/r/${code}`);
    await friendPage.waitForURL('**/login**');
    await friendPage.getByText('You’ve been invited').waitFor();
    const email = await bot.signIn(friendPage, bot.email('friend'));
    await friendPage.getByText('Invite applied').waitFor({ timeout: 15_000 });
    return email;
  });

  await bot.step('The friend likes it and leaves a comment', async () => {
    await friendPage.goto(`${bot.web}/p/${slug}`);
    await friendPage.getByRole('button', { name: /^Like$/ }).click();
    await friendPage.getByRole('button', { name: /^Liked$/ }).waitFor();
    await friendPage.getByLabel('Write a comment').fill('Lovely palette. Does the enquiry form work on WhatsApp Business too?');
    await friendPage.getByRole('button', { name: 'Comment', exact: true }).click();
    await friendPage.getByText('Lovely palette').waitFor();
  });

  await bot.step('The friend saves it to a new public collection', async () => {
    await friendPage.getByRole('button', { name: 'Save', exact: true }).click();
    await friendPage.getByLabel('New collection').fill('Stay ideas');
    await friendPage.getByRole('button', { name: 'Create', exact: true }).click();
    await friendPage.getByRole('button', { name: /Stay ideas/ }).waitFor();
    await friendPage.keyboard.press('Escape');
  });

  await bot.step('The friend follows the creator and sees the project in Following', async () => {
    await friendPage.getByRole('link', { name: /@/ }).first().click();
    await friendPage.waitForURL('**/c/**');
    await friendPage.getByRole('button', { name: 'Follow', exact: true }).click();
    await friendPage.getByRole('button', { name: 'Following' }).waitFor();
    await friendPage.goto(`${bot.web}/explore`);
    await friendPage.getByRole('radio', { name: 'Following' }).click();
    await friendPage.getByText(title).first().waitFor();
  });

  await bot.step('The creator replies to the comment, marked as the creator', async () => {
    await page.goto(`${bot.web}/p/${slug}`);
    await page.getByRole('button', { name: 'Reply' }).first().click();
    await page.getByLabel('Write a reply').fill('Yes, it opens a chat with your WhatsApp Business number.');
    await page.getByRole('button', { name: 'Reply', exact: true }).last().click();
    await page.getByText('Creator', { exact: true }).first().waitFor();
    await bot.shot(page, 'comments');
  });

  await bot.step('The friend remixes it into their own project (published version only)', async () => {
    await friendPage.goto(`${bot.web}/p/${slug}`);
    await friendPage.getByRole('button', { name: /Remix with AI/ }).click();
    await friendPage.getByRole('dialog').getByRole('button', { name: 'Remix with AI' }).click();
    await friendPage.waitForURL('**/projects/**');
    await friendPage.getByText(`Remix of ${title}`).first().waitFor();
    const mine = await bot.call(friend, 'GET', '/projects');
    const list = Array.isArray(mine) ? mine : mine.items;
    bot.check(list.some((p) => p.id !== id), 'the remix is not in the friend’s own projects');
  });

  await bot.step('The referral waits for the friend’s first payment (no reward for a free sign-up)', async () => {
    await page.goto(`${bot.web}/invite`);
    await page.getByText(/Waiting for first payment/).locator('visible=true').first().waitFor();
  });
}
