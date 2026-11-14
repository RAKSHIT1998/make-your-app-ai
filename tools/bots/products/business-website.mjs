export const meta = { name: 'business-website', product: 'Business websites', covers: 'build a business site, publish it, it appears in Explore with a working public page, share image and creator page' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const id = await bot.step('Create a business website with AI', () => bot.createProject(page, { type: /^Business Website/, idea: 'A website for our dental clinic in Jammu with services, doctors and appointment enquiries.' }));
  const title = `Sharma Dental ${bot.device} ${Date.now() % 100000}`;

  const slug = await bot.step('Publish from the Share panel', async () => {
    await page.getByRole('button', { name: 'Share' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Title').fill(title);
    await dlg.getByLabel(/^Description/).fill('Gentle family dentistry in Jammu: check-ups, braces and same-day appointments.');
    await dlg.getByRole('combobox', { name: /Category/ }).selectOption('health');
    await dlg.getByRole('button', { name: 'Publish' }).click();
    await dlg.getByText('Share your project').waitFor();
    const pub = await bot.call(email, 'GET', `/projects/${id}/publishing`);
    bot.check(pub.visibility === 'public' && pub.slug, 'project is not public after publishing');
    await bot.shot(page, 'published');
    return pub.slug;
  });

  const visitor = await bot.page({ label: 'visitor' });
  await bot.step('A visitor finds it in Explore by searching', async () => {
    await visitor.goto(`${bot.web}/explore`);
    await visitor.getByLabel('Search projects').fill(title);
    await visitor.getByText(title).first().waitFor({ timeout: 20_000 });
    await bot.noSidewaysScroll(visitor, 'Explore');
  });
  await bot.step('Its public page opens with title, creator and Remix', async () => {
    await visitor.getByText(title).first().click();
    await visitor.waitForURL(`**/p/${slug}`);
    await visitor.getByRole('heading', { name: title }).waitFor();
    await visitor.getByRole('button', { name: /Remix with AI/ }).waitFor();
    await bot.noSidewaysScroll(visitor, 'public project page');
    await bot.shot(visitor, 'public-page');
  });
  await bot.step('Link previews work: page meta tags and the share image', async () => {
    const html = await (await fetch(`${bot.web}/p/${slug}`)).text();
    bot.check(html.includes(`og:title" content="${title}`), 'og:title missing from the public page');
    const img = await fetch(`${bot.web}/p/${slug}/opengraph-image`);
    bot.check(img.ok && (img.headers.get('content-type') ?? '').startsWith('image/'), `share image failed: ${img.status}`);
  });
  await bot.step('The creator page lists it', async () => {
    await visitor.getByRole('link', { name: /@/ }).first().click();
    await visitor.waitForURL('**/c/**');
    await visitor.getByText(title).first().waitFor();
  });
  await bot.step('Unpublishing takes the public page down', async () => {
    await bot.call(email, 'PUT', `/projects/${id}/publishing`, { visibility: 'private' });
    const r = await bot.publicCall('GET', `/showcase/${slug}`);
    bot.check(r.status === 404, `public page still served after unpublishing (${r.status})`);
  });
}
