#!/usr/bin/env node
// Product test bots. Each bot uses one product the way a customer would, in a real browser, on a desktop and a phone
// screen, against a throwaway local copy of the platform (stand-in AI and payment providers: free, nothing is charged).
//
//   pnpm bots                         every bot, desktop and phone
//   pnpm bots --only store,game       some bots
//   pnpm bots --device phone          one screen size
//   pnpm bots --list                  what exists
//
// Needs: `pnpm build` done, Postgres reachable at BOTS_ADMIN_DATABASE_URL (default postgres:postgres@localhost:5432),
// and Chrome/Chromium (Playwright's, or BOTS_CHROME=/path/to/chrome). Report: tools/bots/report/report.md
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotFailure, createBot } from './lib/bot.mjs';
import { startStack } from './stack/start.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

const all = [];
for (const f of readdirSync(path.join(HERE, 'products')).filter((f) => f.endsWith('.mjs')).sort()) {
  const mod = await import(path.join(HERE, 'products', f));
  all.push({ ...mod.meta, run: mod.run, file: f });
}
if (args.includes('--list')) {
  for (const b of all) console.log(`${b.name.padEnd(18)} ${b.product}: ${b.covers}`);
  process.exit(0);
}
const only = opt('only')?.split(',').map((s) => s.trim());
const unknown = only?.filter((n) => !all.some((b) => b.name === n)) ?? [];
if (unknown.length) { console.error(`Unknown bot(s): ${unknown.join(', ')}. Use --list.`); process.exit(2); }
const bots = all.filter((b) => !only || only.includes(b.name));
const devices = opt('device') ? [opt('device')] : ['desktop', 'phone'];
const concurrency = Number(process.env.BOTS_CONCURRENCY ?? 3);

const outDir = path.join(HERE, 'report');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, 'shots'), { recursive: true });
mkdirSync(path.join(outDir, 'logs'), { recursive: true });

let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import(process.env.BOTS_PLAYWRIGHT ?? '/opt/npm-tools/node_modules/playwright/index.mjs')); }

const started = Date.now();
console.log(`Starting a fresh local platform for ${bots.length} bot(s) × ${devices.join(' + ')}…`);
const stack = await startStack({ logDir: path.join(outDir, 'logs') });
const launch = (o) => chromium.launch({ args: ['--no-sandbox'], ...o });
const browser = process.env.BOTS_CHROME ? await launch({ executablePath: process.env.BOTS_CHROME })
  : await launch({}).catch(() => launch({ channel: 'chrome' })); // Playwright's Chromium, else the installed Chrome

const jobs = bots.flatMap((b) => devices.filter((d) => !b.devices || b.devices.includes(d)).map((device) => ({ b, device })));
const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { b, device } = jobs[next++];
    const bot = createBot({ name: b.name, device, browser, stack, outDir: path.join(outDir, 'shots') });
    const t0 = Date.now();
    let error = null;
    try { await b.run(bot); } catch (e) { error = e instanceof BotFailure ? e.message : `Unexpected: ${e instanceof Error ? e.stack : e}`; }
    if (error) await bot.failureShots();
    await bot.close();
    const ok = !error && bot.problems.length === 0;
    results.push({ name: b.name, product: b.product, device, ok, ms: Date.now() - t0, error, problems: bot.problems, steps: bot.steps, shots: bot.shots });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${b.name} (${device}) ${((Date.now() - t0) / 1000).toFixed(0)}s${error ? `\n      ${error}` : ''}${bot.problems.map((p) => `\n      problem: ${p}`).join('')}`);
  }
}
try {
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
} finally {
  await browser.close();
  await stack.stop();
}

results.sort((a, b) => a.name.localeCompare(b.name) || a.device.localeCompare(b.device));
const passed = results.filter((r) => r.ok).length;
const summary = { startedAt: new Date(started).toISOString(), minutes: +((Date.now() - started) / 60000).toFixed(1), passed, failed: results.length - passed, results };
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(summary, null, 2));

const md = [
  `# Product bots — ${passed}/${results.length} passed`,
  '',
  `Run ${summary.startedAt}, ${summary.minutes} min, against a fresh local copy of the platform (stand-in AI, payment, shipping and hosting providers).`,
  '',
  '| Bot | Product | Screen | Result | Time | Steps |',
  '|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.product} | ${r.device} | ${r.ok ? '✅ pass' : '❌ fail'} | ${(r.ms / 1000).toFixed(0)}s | ${r.steps.filter((s) => s.ok).length}/${r.steps.length} |`),
  '',
  ...results.filter((r) => !r.ok).flatMap((r) => [
    `## ❌ ${r.name} (${r.device})`,
    r.error ? `**Stopped at:** ${r.error}` : '',
    ...r.problems.map((p) => `- ${p}`),
    '',
    ...r.steps.map((s) => `- ${s.ok ? '✓' : '✗'} ${s.title} (${(s.ms / 1000).toFixed(1)}s)${s.error ? `\n\n  \`\`\`\n  ${s.error.replace(/\n/g, '\n  ')}\n  \`\`\`` : ''}`),
    r.shots.length ? `\nLast screenshot: shots/${r.shots.at(-1)}` : '',
    '',
  ]),
  '## Steps of every bot',
  '',
  ...results.flatMap((r) => [`**${r.name} (${r.device})**: ${r.steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.title}`).join(' · ')}`, '']),
].join('\n');
writeFileSync(path.join(outDir, 'report.md'), md);
console.log(`\n${passed}/${results.length} passed in ${summary.minutes} min. Report: ${path.relative(process.cwd(), path.join(outDir, 'report.md'))}`);
process.exit(passed === results.length ? 0 : 1);
