#!/usr/bin/env node
// Live checks against the deployed platform: is it up, does it work, is it locked down?
// Usage: node scripts/live-check.mjs  (WEB_URL / API_URL override the defaults)
// Read-only by design: it never signs up, buys, builds or changes anything.

const WEB = (process.env.WEB_URL ?? 'https://mya-web.onrender.com').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'https://mya-api.onrender.com').replace(/\/$/, '');
const V = `${API}/api/v1`;
const EVIL = 'https://evil.example';

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, init = {}) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
  }
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }

/** Free Render services sleep when idle; give them up to ~3 minutes to wake before judging anything. */
async function wake(url, label) {
  const until = Date.now() + 180_000;
  let last = '';
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (r.status < 500) return;
      last = `HTTP ${r.status}`;
    } catch (e) { last = e instanceof Error ? e.message : String(e); }
    await sleep(10_000);
  }
  throw new Error(`${label} did not wake up within 3 minutes (${last})`);
}

// ---------- wake both services ----------
await check('API wakes up', () => wake(`${V}/health/live`, 'API'));
await check('Website wakes up', () => wake(WEB, 'Website'));

// ---------- API: up and healthy ----------
await check('API health: service and database OK', async () => {
  const r = await req(`${V}/health`);
  expect(r.status === 200, `HTTP ${r.status}`);
  expect(r.json?.status === 'ok' && r.json?.db === 'ok', `unexpected body ${r.text.slice(0, 120)}`);
});
await check('API public data: plans, templates, explore, flags', async () => {
  const plans = await req(`${V}/billing/plans`);
  expect(plans.status === 200, `plans HTTP ${plans.status}`);
  const t = await req(`${V}/templates`);
  expect(t.status === 200, `templates HTTP ${t.status}`);
  const ex = await req(`${V}/explore`);
  expect(ex.status === 200, `explore HTTP ${ex.status}`);
  const f = await req(`${V}/flags`);
  expect(f.status === 200, `flags HTTP ${f.status}`);
});
await check('API answers unknown routes with 404, not a crash', async () => {
  const r = await req(`${V}/definitely-not-a-route`);
  expect(r.status === 404, `HTTP ${r.status}`);
});

// ---------- API: locked down ----------
await check('Signed-out requests to private data are refused', async () => {
  for (const path of ['/me', '/projects', '/credits', '/admin/analytics', '/billing/overview']) {
    const r = await req(`${V}${path}`);
    expect(r.status === 401 || r.status === 403, `${path} returned HTTP ${r.status}`);
  }
});
await check('Forged sign-in tokens are refused', async () => {
  const fake = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2lnbmF0dXJl';
  const r = await req(`${V}/me`, { headers: { Authorization: `Bearer ${fake}` } });
  expect(r.status === 401, `HTTP ${r.status}`);
});
await check('Unsigned billing webhooks cannot grant credits', async () => {
  for (const provider of ['razorpay', 'stripe']) {
    const r = await req(`${V}/webhooks/billing/${provider}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { amount: 999999 } } } }),
    });
    expect(r.status >= 400 && r.status < 500, `${provider} webhook returned HTTP ${r.status}`);
  }
});
await check('Other websites cannot call the API with a signed-in browser (CORS)', async () => {
  const r = await req(`${V}/me`, { method: 'OPTIONS', headers: { Origin: EVIL, 'Access-Control-Request-Method': 'GET' } });
  const allowed = r.headers.get('access-control-allow-origin');
  expect(allowed !== EVIL && allowed !== '*', `API allowed origin ${allowed}`);
  const ok = await req(`${V}/me`, { method: 'OPTIONS', headers: { Origin: WEB, 'Access-Control-Request-Method': 'GET' } });
  expect(ok.headers.get('access-control-allow-origin') === WEB, `our own website is not allowed (got ${ok.headers.get('access-control-allow-origin')})`);
});
await check('API sends security headers', async () => {
  const r = await req(`${V}/health/live`);
  for (const h of ['x-content-type-options', 'strict-transport-security']) expect(r.headers.get(h), `missing ${h}`);
  expect(!r.headers.get('x-powered-by'), 'x-powered-by header leaks the framework');
});
await check('Customer app data needs a valid app key', async () => {
  const r = await req(`${V}/appdata/pv_${'x'.repeat(32)}/services/countries`);
  expect(r.status === 404, `HTTP ${r.status}`);
});

// ---------- Website ----------
const pages = [
  ['/', 'Build it with AI'],
  ['/pricing', ''],
  ['/explore', ''],
  ['/login', 'Sign in'],
  ['/legal/terms', ''],
  ['/legal/privacy', ''],
];
for (const [path, text] of pages) {
  await check(`Website page ${path} loads`, async () => {
    const r = await req(`${WEB}${path}`);
    expect(r.status === 200, `HTTP ${r.status}`);
    if (text) expect(r.text.includes(text), `missing text "${text}"`);
    expect(!/localhost:\d+/.test(r.text), 'page refers to localhost (wrong build settings)');
  });
}
await check('Website shows a 404 page for unknown addresses', async () => {
  const r = await req(`${WEB}/this-page-does-not-exist-${Date.now()}`);
  expect(r.status === 404, `HTTP ${r.status}`);
});
await check('Website robots.txt and sitemap.xml exist', async () => {
  expect((await req(`${WEB}/robots.txt`)).status === 200, 'robots.txt missing');
  expect((await req(`${WEB}/sitemap.xml`)).status === 200, 'sitemap.xml missing');
});
await check('Website is connected to the live API and Supabase', async () => {
  const code = async (path) => {
    const html = (await req(`${WEB}${path}`)).text;
    let all = html;
    for (const m of html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)) all += (await req(`${WEB}${m[1]}`)).text;
    return all;
  };
  expect((await code('/')).includes(API), `home page code does not point at ${API}`);
  expect(/supabase\.co/.test(await code('/login')), 'sign-in page code has no Supabase address (sign-in would not work)');
});

// ---------- report ----------
const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.ms} ms)${r.ok ? '' : `\n      → ${r.error}`}`);
console.log(`Live check of ${WEB} and ${API}\n`);
console.log(lines.join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Live check: ${results.length - failed.length}/${results.length} passed\n\n| | Check | Time |\n|---|---|---|\n${results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.name}${r.ok ? '' : `<br>${r.error}`} | ${r.ms} ms |`).join('\n')}\n`);
}
process.exit(failed.length ? 1 : 0);
