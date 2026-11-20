export const meta = {
  name: 'load',
  product: 'Many people at once',
  devices: ['desktop'],
  covers: '40 signed-in people and 60 visitors using the API at the same time: no server errors, no requests lost, and answers stay quick; rate limits answer 429 rather than failing',
};

const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

export async function run(bot) {
  const times = [];
  const failures = [];
  const statuses = new Map();
  const timed = async (label, url, init) => {
    const t = performance.now();
    let status = 0;
    try {
      status = (await fetch(url, init)).status;
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
    }
    times.push(performance.now() - t);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    if (status >= 500 || status === 0) failures.push(`${label} → ${status}`);
    return status;
  };

  await bot.step('40 signed-in people work at the same time', async () => {
    const people = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
      const email = bot.email(`load-${i}`);
      return { email, auth: { authorization: `Bearer ${await bot.token(email)}`, 'content-type': 'application/json' } };
    }));
    await Promise.all(people.map(async (p, i) => {
      await timed('me', `${bot.api}/me`, { headers: p.auth });
      await timed('create project', `${bot.api}/projects`, { method: 'POST', headers: p.auth, body: JSON.stringify({ name: `Load ${i}`, type: 'website' }) });
      for (let round = 0; round < 4; round++) {
        await Promise.all([
          timed('projects', `${bot.api}/projects`, { headers: p.auth }),
          timed('billing', `${bot.api}/billing/overview`, { headers: p.auth }),
          timed('activity', `${bot.api}/activity`, { headers: p.auth }),
          timed('estimate', `${bot.api}/generations/estimate`, { headers: p.auth }),
        ]);
      }
    }));
  });

  await bot.step('60 visitors browse public pages at the same time', async () => {
    await Promise.all(Array.from({ length: 60 }, async (_, i) => {
      for (const path of ['/explore', '/flags', '/billing/plans', '/challenges', '/templates']) {
        await timed(`public ${path}`, `${bot.api}${path}`, { headers: { 'x-forwarded-for': `10.9.${Math.floor(i / 250)}.${i % 250}` } });
      }
    }));
  });

  await bot.step('No errors and quick answers', async () => {
    const summary = [...statuses.entries()].sort().map(([s, n]) => `${s}×${n}`).join(' ');
    const p50 = Math.round(pct(times, 50));
    const p95 = Math.round(pct(times, 95));
    console.log(`load: ${times.length} requests · p50 ${p50} ms · p95 ${p95} ms · ${summary}`);
    bot.check(failures.length === 0, `${failures.length} failed requests:\n${[...new Set(failures)].slice(0, 20).join('\n')}`);
    bot.check(p95 < 2500, `slow: p95 ${p95} ms`);
  });
}
