export const meta = { name: 'game', product: 'Games', covers: 'build a game with AI, play it in the sandbox (bricks break, score, game over, restart), sandbox isolation, publish, a visitor plays it, Ask mode' };

export async function run(bot) {
  const page = await bot.page();
  const email = await bot.step('Sign in as a new customer', () => bot.signIn(page));
  const id = await bot.step('Create a game with AI (plan, then build)', () => bot.createProject(page, { type: /^Game/, idea: 'A neon breakout game with bricks, lives and a saved best score' }));
  await bot.shot(page, 'built');

  const frame = await bot.step('Open the game in the live preview', async () => {
    await bot.openPreview(page);
    const el = page.locator('iframe[title="Live preview"]');
    await page.frameLocator('iframe[title="Live preview"]').locator('canvas').first().waitFor({ timeout: 20_000 });
    return (await el.elementHandle()).contentFrame();
  });

  await bot.step('The game runs in a locked sandbox (no access to the site, no network)', async () => {
    bot.allowConsole(/example\.com/);
    const probe = await frame.evaluate(async () => {
      const r = { origin: window.origin, parent: 'open', network: 'open' };
      try { void window.parent.document.cookie; } catch { r.parent = 'blocked'; }
      try { await fetch('https://example.com/'); } catch { r.network = 'blocked'; }
      return r;
    });
    bot.check(probe.origin === 'null', `sandbox origin should be opaque, got ${probe.origin}`);
    bot.check(probe.parent === 'blocked', 'the game can read the parent page');
    bot.check(probe.network === 'blocked', 'the game can reach the network');
  });

  await bot.step('Play: the ball breaks bricks and the score goes up', async () => {
    const canvas = frame.locator('canvas').first();
    await canvas.click({ position: { x: 100, y: 200 } });
    let score = 0;
    for (let i = 0; i < 600 && score < 20; i++) {
      const s = await frame.evaluate(() => ({ bx: state.ball.x, phase: state.phase, score: state.score }));
      score = s.score;
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + (s.bx / 480) * box.width, box.y + box.height * 0.9);
      if (s.phase === 'ready') await page.keyboard.press('Space');
      await page.waitForTimeout(20);
    }
    bot.check(score > 0, 'no bricks broke after playing for a while');
    // Read the game's score and the on-screen number in the same instant (the ball keeps moving between reads).
    const shown = await frame.evaluate(() => ({ score: state.score, hud: document.querySelector('#score')?.textContent ?? '' }));
    bot.check(shown.hud.includes(String(shown.score)), `score display "${shown.hud}" does not show ${shown.score}`);
  });
  await bot.shot(page, 'playing');

  await bot.step('Game over, then Restart starts a new game and keeps the best score', async () => {
    await frame.evaluate(() => { state.lives = 1; state.phase = 'playing'; state.ball.y = 700; state.ball.vy = 100; });
    await page.waitForTimeout(400);
    bot.check(await frame.evaluate(() => state.phase) === 'over', 'losing the last life did not end the game');
    const best = await frame.evaluate(() => state.best);
    await bot.waitForToasts(page);
    await frame.locator('#restart').click();
    const after = await frame.evaluate(() => ({ score: state.score, best: state.best, phase: state.phase }));
    bot.check(after.score === 0 && after.phase !== 'over', 'Restart did not start a new game');
    bot.check(after.best === best && best > 0, 'best score was lost on restart');
  });

  await bot.step('Ask mode answers from the project files without changing the code', async () => {
    const before = (await bot.call(email, 'GET', `/projects/${id}`)).headVersionId;
    if (bot.isPhone) await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByRole('radio', { name: 'Ask', exact: true }).click();
    await page.getByLabel('Message the AI').fill('How fast does the ball get each level?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/8% faster/).first().waitFor({ timeout: 30_000 });
    bot.check((await bot.call(email, 'GET', `/projects/${id}`)).headVersionId === before, 'asking a question changed the code');
  });

  const slug = await bot.step('Publish the game', async () => (await bot.publish(email, id, 'Neon Breakout', 'Break every brick before you run out of lives.', 'other')).slug);

  await bot.step('A visitor (not signed in) plays it on the public page', async () => {
    const visitor = await bot.page({ label: 'visitor' });
    await visitor.goto(`${bot.web}/p/${slug}`);
    await visitor.getByRole('button', { name: 'Play Neon Breakout' }).click();
    await visitor.frameLocator('iframe').first().locator('canvas').first().waitFor({ timeout: 20_000 });
    await bot.noSidewaysScroll(visitor, 'the public game page');
    await bot.shot(visitor, 'public-play');
  });
}
