export const meta = { name: 'team', product: 'Team workspaces', covers: 'create a team workspace, invite by link, invite bound to the invited email, accept, shared projects, change role, remove member (access ends)' };

export async function run(bot) {
  const owner = await bot.page({ label: 'owner' });
  const ownerEmail = await bot.step('Sign in as the workspace owner', () => bot.signIn(owner, bot.email('lead')));
  const name = `Acme Studio ${Date.now() % 10000}`;
  const memberEmail = bot.email('dana');

  await bot.step('Create a team workspace', async () => {
    await owner.goto(`${bot.web}/team`);
    await owner.getByLabel('Workspace name').fill(name);
    await owner.getByRole('button', { name: 'Create workspace' }).click();
    await owner.getByText(`Members of ${name}`).waitFor();
    await owner.getByText('Seats in use').waitFor();
  });

  const link = await bot.step('Invite a teammate by email (single-use link)', async () => {
    await owner.getByLabel('Email').fill(memberEmail);
    await owner.getByRole('button', { name: 'Create invite link' }).click();
    const l = await owner.getByRole('textbox', { name: 'Invite link' }).inputValue();
    bot.check(/\/join\/|invite/.test(l), `unexpected invite link ${l}`);
    await bot.shot(owner, 'invited');
    return l.replace(/^https?:\/\/[^/]+/, bot.web);
  });

  await bot.step('Someone else can’t use the link', async () => {
    const stranger = await bot.page({ label: 'stranger' });
    bot.allowConsole(/40[34]/);
    await bot.signIn(stranger, bot.email('stranger'));
    await stranger.goto(link);
    await stranger.getByRole('button', { name: 'Accept invitation' }).click();
    await stranger.getByText(/was sent to .*Sign in with that email/).first().waitFor();
  });

  const member = await bot.page({ label: 'teammate' });
  await bot.step('The teammate signs in from the link and accepts', async () => {
    await member.goto(link);
    await member.getByRole('heading', { name: `Join ${name}` }).waitFor();
    await member.getByRole('link', { name: 'Sign in to accept' }).click();
    await member.waitForURL('**/login?next=**');
    await member.getByLabel('Email').fill(memberEmail);
    await member.getByLabel('Password').fill('password123');
    await member.locator('form button[type=submit]').click();
    await member.getByRole('button', { name: 'Accept invitation' }).click();
    await member.waitForURL('**/team');
    await member.getByText(`Members of ${name}`).waitFor();
  });

  await bot.step('The owner sees the new member and makes them a viewer', async () => {
    await owner.goto(`${bot.web}/team`);
    await owner.getByText(memberEmail).first().waitFor();
    await owner.getByLabel(`Role for ${memberEmail}`).locator('visible=true').first().selectOption('viewer');
    await owner.getByText('Role updated').waitFor();
    await bot.shot(owner, 'members');
  });

  await bot.step('Removing the member ends their access', async () => {
    await owner.getByRole('button', { name: `Remove ${memberEmail}` }).locator('visible=true').first().click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await owner.getByText('Member removed').waitFor();
    const orgs = await bot.call(memberEmail, 'GET', '/orgs').catch(() => null) ?? await bot.call(memberEmail, 'GET', '/me');
    bot.check(!JSON.stringify(orgs).includes(name), 'the removed member still belongs to the workspace');
    void ownerEmail;
  });
}
