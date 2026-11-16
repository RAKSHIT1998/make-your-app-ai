export const meta = { name: 'challenges', product: 'Weekly challenges and leaderboards', covers: 'owner creates a challenge in the owner console, creators enter published games, new accounts wait a day to vote, voting limits and no self-votes, ranking, winners and badges after it ends, top-creators leaderboard' };

export async function run(bot) {
  const slug = `bot-arcade-${bot.isPhone ? 'p' : 'd'}-${Date.now().toString(36)}`;
  const owner = await bot.page({ label: 'owner' });
  await bot.step('The owner creates a challenge in the owner console', async () => {
    await bot.signIn(owner, bot.ownerEmail);
    await owner.goto(`${bot.web}/admin`);
    await owner.getByRole('tab', { name: 'Challenges' }).click();
    await owner.getByRole('button', { name: 'New challenge' }).first().click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Title').fill('Bot arcade week');
    await dlg.getByLabel('Address').fill(slug);
    await dlg.getByLabel('Brief').fill('Build a one-screen arcade game that anyone can pick up and play in under a minute.');
    await dlg.getByLabel('Game', { exact: true }).check();
    const now = Date.now(); const local = (t) => new Date(t - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await dlg.getByLabel('Starts').fill(local(now - 3600_000));
    await dlg.getByLabel('Entries close').fill(local(now + 2 * 86_400_000));
    await dlg.getByLabel('Voting closes').fill(local(now + 3 * 86_400_000));
    await dlg.getByLabel(/^Prize/).fill('A month of Creator');
    await dlg.getByLabel('Votes each').fill('2');
    await dlg.getByLabel('Status').selectOption('published');
    await dlg.getByRole('button', { name: 'Create challenge' }).click();
    await owner.getByText('Bot arcade week').first().waitFor();
    await bot.waitForToasts(owner);
    await bot.shot(owner, 'owner-console');
  });

  // Two creators each build and publish a game, then enter it from the challenge page.
  const makers = [];
  for (const label of ['maker-a', 'maker-b']) {
    const page = await bot.page({ label });
    const email = await bot.step(`${label}: sign in, build and publish a game`, async () => {
      const e = await bot.signIn(page, bot.email(label));
      const id = await bot.createProject(page, { type: /^Game/, idea: 'A one-screen breakout game with paddle, bricks and a score' });
      await bot.publish(e, id, `${label} Breakout`, 'A quick breakout game for the arcade week challenge.', 'personal');
      return e;
    });
    await bot.step(`${label}: enter the game from the challenge page`, async () => {
      await page.goto(`${bot.web}/challenges/${slug}`);
      await page.getByRole('heading', { name: 'Bot arcade week' }).waitFor();
      await page.getByLabel(/A line about it/).fill('Made with the AI in minutes');
      await page.getByRole('button', { name: 'Enter challenge' }).click();
      await page.getByText('Your entry is in:').waitFor();
      await bot.waitForToasts(page);
    });
    makers.push({ page, email });
  }

  const voter = await bot.page({ label: 'voter' });
  const voterEmail = await bot.step('A brand-new account can’t vote yet', async () => {
    const e = await bot.signIn(voter, bot.email('voter'));
    await voter.goto(`${bot.web}/challenges/${slug}`);
    await voter.getByText('maker-a Breakout').waitFor();
    bot.allowConsole(/403/);
    const [res] = await Promise.all([
      voter.waitForResponse((r) => r.url().includes('/vote') && r.request().method() === 'PUT'),
      voter.getByRole('button', { name: /Vote/ }).first().click(),
    ]);
    bot.check(res.status() === 403, `a brand-new account's vote answered ${res.status()}`);
    await voter.getByText('New accounts can vote one day after signing up.', { exact: true }).waitFor();
    return e;
  });
  await bot.step('A day later they vote; the ranking updates; their own entry can’t be voted for', async () => {
    await bot.sql(`UPDATE "User" SET "createdAt" = now() - interval '2 days' WHERE email = $1 OR email = $2`, [voterEmail, makers[0].email]);
    await voter.reload();
    const rowB = voter.getByRole('listitem').filter({ hasText: 'maker-b Breakout' });
    await rowB.getByRole('button', { name: /Vote/ }).click();
    await rowB.getByRole('button', { name: /Voted/ }).waitFor();
    await voter.getByText('1 of 2 votes left').waitFor();
    // maker-a votes for maker-b too; their own row's button is disabled.
    const a = makers[0].page;
    await a.reload();
    const own = a.getByRole('listitem').filter({ hasText: 'maker-a Breakout' });
    bot.check(await own.getByRole('button', { name: /Vote/ }).isDisabled(), 'a creator could vote for their own entry');
    await a.getByRole('listitem').filter({ hasText: 'maker-b Breakout' }).getByRole('button', { name: /Vote/ }).click();
    await a.getByRole('listitem').filter({ hasText: 'maker-b Breakout' }).getByText('2', { exact: true }).waitFor();
    const d = await bot.publicCall('GET', `/challenges/${slug}`);
    bot.check(d.body.entries[0].project.title === 'maker-b Breakout' && d.body.entries[0].votes === 2 && d.body.entries[0].rank === 1, `ranking wrong: ${JSON.stringify(d.body.entries.map((e) => [e.project.title, e.votes, e.rank]))}`);
    await bot.noSidewaysScroll(voter, 'the challenge page');
    await bot.shot(voter, 'voting');
  });
  await bot.step('When voting closes, the top entries are winners and earn a badge', async () => {
    await bot.sql(`UPDATE "Challenge" SET "startsAt" = now() - interval '4 days', "submissionsCloseAt" = now() - interval '2 days', "votingClosesAt" = now() - interval '1 minute' WHERE slug = $1`, [slug]);
    await voter.reload();
    await voter.getByRole('heading', { name: 'Final ranking' }).waitFor();
    await voter.getByText('Winner · #1').waitFor();
    bot.check(await voter.getByRole('button', { name: /Vote/ }).count() === 0, 'vote buttons still showing after voting closed');
    const ach = await bot.call(makers[1].email, 'GET', '/me/achievements');
    bot.check(ach.badges.find((b) => b.key === 'challenge_podium')?.earnedAt, 'the winner has no podium badge');
    await bot.shot(voter, 'winners');
  });
  await bot.step('Challenges list and the top-creators leaderboard', async () => {
    await voter.goto(`${bot.web}/challenges`);
    await voter.getByText('Bot arcade week').first().waitFor();
    await voter.goto(`${bot.web}/leaderboard`);
    await voter.getByRole('heading', { name: 'Top creators' }).waitFor();
    await voter.getByRole('table').waitFor();
    await bot.noSidewaysScroll(voter, 'the leaderboard');
  });
}
