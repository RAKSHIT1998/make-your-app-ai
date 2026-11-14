import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { APP_CONFIG, type AppConfig } from '../src/config.js';
import { buildSiteBrief, plainText } from '../src/importer/site-brief.js';
import { checkPublicUrl } from '../src/importer/site-import.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

const V = '/api/v1';
const TOKEN = 'crawler-token-crawler-token-123';
const PAGES = [
  { url: 'http://127.0.0.1:1/', title: 'Kashmir Walnut Co.', description: 'Family orchard selling Kashmiri walnuts since 1987.', markdown: '[About](/about) [Products](/products)\n# Kashmir Walnut Co.\nHand-picked walnuts from our orchard in **Pulwama**.\n![Orchard](http://127.0.0.1:1/img/o.jpg)', images: [{ src: 'http://127.0.0.1:1/img/o.jpg', alt: 'Orchard' }] },
  { url: 'http://127.0.0.1:1/products', title: 'Products', description: '', markdown: '# Products\n- Snow-white kernels, 500 g — ₹899\n- Gift box — ₹1,299', images: [] },
  { url: 'http://127.0.0.1:1/contact', title: 'Contact', description: '', markdown: 'Call +91 94190 12345 or email Orders@KashmirWalnut.example', images: [] },
];

/** Stand-in for services/crawler: same contract, records what the API sent. */
const calls: { token: string | undefined; body: { url: string; maxPages: number } }[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
let crawler: Server;
let crawlerUrl: string;

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  crawler = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      calls.push({ token: req.headers['x-crawler-token'] as string | undefined, body: JSON.parse(raw || '{}') });
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => crawler.listen(0, '127.0.0.1', r));
  crawlerUrl = `http://127.0.0.1:${(crawler.address() as AddressInfo).port}`;
  ({ app, prisma } = await createTestApp({ env: { CRAWLER_URL: crawlerUrl, CRAWLER_TOKEN: TOKEN, SITE_IMPORTS_PER_DAY: '3', SITE_IMPORT_ALLOW_PRIVATE_NETWORKS: 'true' } }));
});
afterAll(async () => { await app?.close(); await new Promise((r) => crawler.close(r)); });
beforeEach(async () => { await resetDb(prisma); calls.length = 0; reply = { status: 200, body: { url: 'http://127.0.0.1:1/', host: '127.0.0.1', pages: PAGES, skipped: [{ url: 'http://127.0.0.1:1/private/', reason: 'robots.txt does not allow it' }], seconds: 1.2 } }; });

async function login(label: string) {
  const id = newIdentity(label);
  const auth = `Bearer ${await tokenFor(id.id, id.email)}`;
  await http().get(`${V}/me`).set('Authorization', auth).expect(200);
  return { auth, id };
}

describe('Start from your current website', () => {
  it('reads the customer’s own site through the crawler and returns an editable brief built from their words', async () => {
    const a = await login('importer');
    expect((await http().get(`${V}/imports/site`).set('Authorization', a.auth).expect(200)).body).toEqual({ available: true, perDay: 3, maxPages: 10 });

    // Ownership must be confirmed, and the crawler is never called without it.
    await http().post(`${V}/imports/site`).set('Authorization', a.auth).send({ url: 'http://127.0.0.1:1/' }).expect(400);
    await http().post(`${V}/imports/site`).set('Authorization', a.auth).send({ url: 'http://127.0.0.1:1/', confirmOwnership: false }).expect(400);
    expect(calls).toHaveLength(0);

    const r = (await http().post(`${V}/imports/site`).set('Authorization', a.auth).send({ url: 'http://127.0.0.1:1/', maxPages: 4, confirmOwnership: true }).expect(200)).body;
    expect(calls).toEqual([{ token: TOKEN, body: { url: 'http://127.0.0.1:1/', maxPages: 4 } }]);
    expect(r.pages.map((p: { title: string }) => p.title)).toEqual(['Kashmir Walnut Co.', 'Products', 'Contact']);
    expect(r.skipped).toEqual([{ url: 'http://127.0.0.1:1/private/', reason: 'robots.txt does not allow it' }]);
    expect(r.images).toEqual([{ src: 'http://127.0.0.1:1/img/o.jpg', alt: 'Orchard' }]);
    expect(r.brief).toContain('Current site: http://127.0.0.1:1/');
    expect(r.brief).toContain('About: Family orchard selling Kashmiri walnuts since 1987.');
    expect(r.brief).toContain('Snow-white kernels, 500 g — ₹899');
    expect(r.brief).toMatch(/Contact: \+91 94190 12345 · orders@kashmirwalnut\.example/);
    expect(r.brief).toContain('Do not invent prices, reviews');
    expect(r.brief).not.toMatch(/\]\(|!\[|\*\*/); // plain text, no markdown syntax
    expect(r.brief.length).toBeLessThanOrEqual(6000);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'site.imported' } });
    expect(log.metadata).toMatchObject({ url: 'http://127.0.0.1:1/', pages: 3, skipped: 1 });
  });

  it('limits imports per person per day', async () => {
    const a = await login('daily');
    for (let i = 0; i < 3; i++) await http().post(`${V}/imports/site`).set('Authorization', a.auth).send({ url: 'http://127.0.0.1:1/', confirmOwnership: true }).expect(200);
    const r = await http().post(`${V}/imports/site`).set('Authorization', a.auth).send({ url: 'http://127.0.0.1:1/', confirmOwnership: true }).expect(429);
    expect(r.body.code).toBe('site_import_daily_limit');
    expect(calls).toHaveLength(3);
    // Someone else still can.
    const b = await login('other');
    await http().post(`${V}/imports/site`).set('Authorization', b.auth).send({ url: 'http://127.0.0.1:1/', confirmOwnership: true }).expect(200);
  });

  it('passes on the crawler’s honest failures and never fakes a result', async () => {
    const a = await login('fails');
    const send = () => http().post(`${V}/imports/site`).set('Authorization', a.auth).send({ url: 'http://127.0.0.1:1/', confirmOwnership: true });
    reply = { status: 422, body: { detail: 'Couldn\'t read 127.0.0.1: robots.txt does not allow it' } };
    expect((await send().expect(422)).body.message).toContain('robots.txt');
    reply = { status: 504, body: { detail: 'The website took too long to read.' } };
    expect((await send().expect(504)).body.message).toContain('too long');
    reply = { status: 429, body: { detail: 'The website reader is busy. Try again in a minute.' } };
    await send().expect(429);
    reply = { status: 401, body: { detail: 'unauthorised' } };
    expect((await send().expect(502)).body.message).toBe('The website reader had a problem. Please try again.');
    expect(await prisma.auditLog.count({ where: { action: 'site.imported' } })).toBe(0);

    // Crawler down → clear 503; not set up → 503 and the Create page hides the option; switched off → 503.
    const cfg = app.get(APP_CONFIG) as AppConfig;
    const saved = cfg.CRAWLER_URL;
    cfg.CRAWLER_URL = 'http://127.0.0.1:9';
    expect((await send().expect(503)).body.code).toBe('site_import_unavailable');
    cfg.CRAWLER_URL = undefined;
    expect((await send().expect(503)).body.code).toBe('site_import_unavailable');
    expect((await http().get(`${V}/imports/site`).set('Authorization', a.auth).expect(200)).body.available).toBe(false);
    cfg.CRAWLER_URL = saved;
    await prisma.platformFlag.upsert({ where: { key: 'site_import' }, update: { enabled: false }, create: { key: 'site_import', enabled: false, description: 'x' } });
    await new Promise((r) => setTimeout(r, 5100)); // flag cache
    expect((await send().expect(503)).body.code).toBe('feature_disabled');
    expect((await http().get(`${V}/imports/site`).set('Authorization', a.auth).expect(200)).body.available).toBe(false);
    await prisma.platformFlag.update({ where: { key: 'site_import' }, data: { enabled: true } });
  }, 20_000);

  it('requires sign-in', async () => {
    await http().post(`${V}/imports/site`).send({ url: 'https://example.com', confirmOwnership: true }).expect(401);
  });
});

describe('address checks (before anything leaves the API)', () => {
  it('only allows public http(s) addresses', async () => {
    for (const u of ['http://127.0.0.1/', 'http://10.0.0.8/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'http://printer.local/', 'http://100.64.1.1/', 'https://example.com:8443/', 'ftp://example.com/', 'https://user:pw@example.com/', 'javascript:alert(1)']) {
      await expect(checkPublicUrl(u), u).rejects.toMatchObject({ status: 400 });
    }
    expect((await checkPublicUrl('93.184.215.14')).toString()).toBe('https://93.184.215.14/');
    expect((await checkPublicUrl('https://93.184.215.14/about#team')).toString()).toBe('https://93.184.215.14/about');
  });

  it('keeps the brief within the Create box and readable', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ url: `https://shop.example/p${i}`, title: `Page ${i}`, description: '', markdown: 'Lorem ipsum dolor sit amet. '.repeat(400) }));
    const brief = buildSiteBrief('https://shop.example/', many);
    expect(brief.length).toBeLessThanOrEqual(6000);
    expect(brief.match(/^- \/p\d/gm)).toHaveLength(10);
    expect(plainText('## Hi [there](https://x.y) ![a](b.png) **bold** `code`')).toBe('Hi there bold code');
  });
});
