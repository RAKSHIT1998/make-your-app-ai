// What every product bot gets: a browser on a desktop or phone screen, a fresh customer, steps that are timed and
// reported, screenshots, page-error and layout checks, and small helpers for the platform's own flows.
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { TEST } from '../stack/emulators.mjs';

export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

/** Console messages that are expected and not problems (the platform answering a bot's deliberate bad input). */
const EXPECTED_CONSOLE = [/Failed to load resource: the server responded with a status of 4\d\d/, /favicon/];

export class BotFailure extends Error {}

export function createBot({ name, device, browser, stack, outDir }) {
  const steps = [];
  const problems = [];
  const shots = [];
  const contexts = [];
  const allowed = [...EXPECTED_CONSOLE];
  const short = device === 'phone' ? 'phone' : 'desktop';
  let shotN = 0;
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

  const bot = {
    name, device, isPhone: device === 'phone', web: stack.webUrl, phoneApp: stack.phoneUrl, api: `${stack.apiUrl}/api/v1`, ownerEmail: stack.ownerEmail,
    steps, problems, shots,

    /** A unique, throwaway customer email for this run. */
    email: (label = name) => `${label}-${short}-${stamp}@bots.example.com`.toLowerCase(),

    /** A new browser window (its own cookies and storage), watched for page errors. */
    async page({ device: d = device, label = 'customer' } = {}) {
      const ctx = await browser.newContext({ ...DEVICES[d], locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      page.on('pageerror', (e) => problems.push(`${label}: script error on ${page.url()}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (!allowed.some((re) => re.test(t))) problems.push(`${label}: console error on ${page.url()}: ${t.slice(0, 300)}`);
      });
      page.on('response', (r) => { if (r.status() >= 500 && r.url().startsWith(stack.apiUrl)) problems.push(`${label}: server error ${r.status()} from ${r.request().method()} ${r.url().replace(stack.apiUrl, '')}`); });
      return page;
    },

    /** Runs one named step; its time and outcome go into the report. A failing step stops the bot. */
    async step(title, fn) {
      const t0 = Date.now();
      try {
        const out = await fn();
        steps.push({ title, ok: true, ms: Date.now() - t0 });
        return out;
      } catch (e) {
        steps.push({ title, ok: false, ms: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 6).join('\n') });
        throw new BotFailure(`${title}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      }
    },

    /** Declares console messages this bot causes on purpose (for example a deliberate blocked network call). */
    allowConsole(...res) { allowed.push(...res); },

    check(cond, message) { if (!cond) throw new Error(message); },

    async shot(page, label, { full = false } = {}) {
      const file = `${name}-${short}-${String(++shotN).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
      await page.screenshot({ path: path.join(outDir, file), fullPage: full }).catch(() => {});
      shots.push(file);
    },

    /** Fails the step when the page scrolls sideways (content wider than the screen). */
    async noSidewaysScroll(page, where) {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) throw new Error(`${where} is ${over}px wider than the ${short} screen`);
    },

    /** Signs in through the real login page. Any password works against the auth stand-in. */
    async signIn(page, email = bot.email()) {
      await page.goto(`${bot.web}/login`);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill('password123');
      await page.locator('form button[type=submit]').click();
      await page.waitForURL(/\/(home|team|projects|create)/, { timeout: 30_000 });
      return email;
    },

    /** Waits for on-screen notifications to fade, as a person would before tapping what they covered. */
    async waitForToasts(page) {
      await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
    },

    /** An access token for API calls the customer's browser would make (used for setup and for reading results). */
    async token(email) {
      const r = await fetch(`${stack.authUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
      return (await r.json()).access_token;
    },

    /** Calls the platform API as a signed-in customer. Throws with the server's message on failure. */
    async call(email, method, p, body) {
      const r = await fetch(`${bot.api}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await bot.token(email)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },

    /** Calls a public endpoint (no sign-in). Returns {status, body}. */
    async publicCall(method, p, body, headers = {}) {
      const r = await fetch(`${bot.api}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: json ?? text, headers: r.headers };
    },

    /**
     * Creates a project from the Create page like a customer: pick the type, describe it, generate (through the plan
     * step when the platform offers one), and wait for the first saved version. Returns the project id.
     */
    async createProject(page, { type, idea, kit }) {
      await page.goto(`${bot.web}/create${kit ? `?kit=${kit}` : ''}`);
      if (type) await page.getByRole('radio', { name: type }).click();
      if (idea) await page.getByLabel('Describe your idea').fill(idea);
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const planFirst = (await dialog.getByRole('button', { name: 'Draft plan' }).count()) > 0;
      await dialog.getByRole('button', { name: /^(Draft plan|Generate project)$/ }).click();
      await page.waitForURL('**/projects/**', { timeout: 30_000 });
      const id = page.url().split('/projects/')[1].split(/[/?#]/)[0];
      if (planFirst) await page.getByRole('button', { name: 'Build this plan' }).click({ timeout: 60_000 });
      await page.getByText(/Saved version/).first().waitFor({ timeout: 120_000 });
      await page.waitForTimeout(800);
      return id;
    },

    /** Opens the sandboxed live preview in the builder and returns a locator for inside it. */
    async openPreview(page) {
      await page.getByRole('tab', { name: /^(Preview|Play|Shop)$/ }).first().click();
      return page.frameLocator('iframe[title="Live preview"]');
    },

    /** Publishes a project to Explore through the API the Share panel uses. */
    async publish(email, projectId, title, description, category = 'business') {
      return bot.call(email, 'PUT', `/projects/${projectId}/publishing`, { visibility: 'public', publicTitle: title, publicDescription: description, category });
    },

    /** Sends a correctly signed Razorpay webhook to a store, exactly as Razorpay would. */
    async storeWebhook(storeId, event, payload) {
      const raw = JSON.stringify({ event, payload });
      const r = await fetch(`${bot.api}/webhooks/payments/razorpay/${storeId}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', TEST.storeRazorpay.webhookSecret).update(raw).digest('hex'), 'x-razorpay-event-id': randomUUID() }, body: raw });
      return r.json();
    },

    /** Sends a correctly signed Razorpay webhook for the platform's own billing. */
    async billingWebhook(event, payload) {
      const raw = JSON.stringify({ event, payload });
      const r = await fetch(`${bot.api}/webhooks/billing/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-event-id': randomUUID(), 'x-razorpay-signature': createHmac('sha256', TEST.platformRazorpay.webhookSecret).update(raw).digest('hex') }, body: raw });
      return r.json();
    },

    /** Razorpay's checkout.js can't load offline; this stand-in records what the page asked it to open. */
    async fakeRazorpayCheckout(page, { pay } = {}) {
      const body = pay
        ? 'window.Razorpay=function(o){this.on=function(){};this.open=function(){window.__rzp=o;setTimeout(function(){o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:"pay_bot",razorpay_signature:"not-a-real-signature"})},300)}}'
        : 'window.Razorpay=function(o){this.on=function(){};this.open=function(){window.__rzp=o}}';
      await page.route('https://checkout.razorpay.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body }));
    },

    /** On failure: a screenshot of every open window, so the report shows what the customer was looking at. */
    async failureShots() {
      let i = 0;
      for (const c of contexts) for (const pg of c.pages()) await bot.shot(pg, `failed-window-${++i}`).catch(() => {});
    },

    /**
     * Moves time for one thing in the bots' own throwaway database, for rules that wait on the clock
     * (a new account may vote a day after signing up; a challenge ends). Never used for anything a customer could do.
     */
    async sql(text, params = []) {
      const pg = createRequire(path.resolve(import.meta.dirname, '../../../packages/db/package.json'))('pg');
      const db = new pg.Client({ connectionString: stack.databaseUrl });
      await db.connect();
      try { return (await db.query(text, params)).rows; } finally { await db.end(); }
    },
    async close() { for (const c of contexts) await c.close().catch(() => {}); },
  };
  return bot;
}
