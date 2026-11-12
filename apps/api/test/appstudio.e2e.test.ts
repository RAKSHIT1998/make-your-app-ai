import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ProviderRouter, ScriptedProvider, type AiProvider, type CompletionRequest } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { AI_ROUTER } from '../src/ai/ai.providers.js';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';
import { FakeHosting } from '@mya/hosting';
import { HOSTING_HEALTH_CHECK, HOSTING_PROVIDER } from '../src/hosting/hosting.service.js';
import { DESIGN, HERO, HOME, ROOMS_LIB, ROOMS_PAGE, SPEC } from './fixtures.js';
const V = '/api/v1';

const json = (v: unknown) => JSON.stringify(v);
const CODE = json({ summary: 'Home + rooms', patches: [
  { op: 'create', path: 'components/Hero.tsx', content: HERO, reason: '' },
  { op: 'create', path: 'lib/rooms.ts', content: ROOMS_LIB, reason: '' },
  { op: 'update', path: 'app/page.tsx', content: HOME, reason: '' },
  { op: 'create', path: 'app/rooms/page.tsx', content: ROOMS_PAGE, reason: '' },
] });
const CREATE_SCRIPT = [json(SPEC), json(DESIGN), CODE];

/** Scripted provider whose replies are queued per test; optionally blocks until released. */
class QueueProvider implements AiProvider {
  readonly name = 'scripted';
  inner = new ScriptedProvider('scripted', []);
  gate: Promise<void> | null = null;
  queue(replies: string[]) {
    this.inner = new ScriptedProvider('scripted', [...replies]);
  }
  capabilities() {
    return { structuredOutput: true, maxOutputTokens: 64_000 };
  }
  async complete(model: string, req: CompletionRequest) {
    if (this.gate) await this.gate;
    return this.inner.complete(model, req);
  }
}

const provider = new QueueProvider();
const hosting = new FakeHosting(2);
const router = new ProviderRouter([provider], (['fast', 'balanced', 'deep'] as const).map((tier) => ({ provider: 'scripted', model: `m-${tier}`, tier, priority: 1, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true })), { sleep: async () => {} });

let app: INestApplication;
let prisma: PrismaClient;
let gen: GenerationsService;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  ({ app, prisma } = await createTestApp({ env: { ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), MAX_DEPLOYMENTS_PER_DAY: '6', DEPLOY_RATE_LIMIT_PER_MINUTE: '1000' }, overrides: [{ provide: AI_ROUTER, useValue: router }, { provide: HOSTING_PROVIDER, useValue: hosting }, { provide: HOSTING_HEALTH_CHECK, useValue: async (url: string) => ({ ok: !url.includes('unhealthy'), status: 200 }) }] }));
  gen = app.get(GenerationsService);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  provider.gate = null;
  await resetDb(prisma);
});

async function login(label: string) {
  const u = newIdentity(label);
  const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
  const me = await http().get('/api/v1/me').set('Authorization', auth).expect(200);
  return { ...u, auth, orgId: me.body.personalOrgId as string };
}
async function newProject(auth: string, type = 'website') {
  return (await http().post('/api/v1/projects').set('Authorization', auth).send({ name: 'Grand Lake', type }).expect(201)).body.id as string;
}
async function generate(auth: string, projectId: string, prompt: string) {
  const res = await http().post(`/api/v1/projects/${projectId}/generations`).set('Authorization', auth).send({ prompt });
  if (res.status === 202) await gen.waitFor(res.body.id);
  return res;
}





const MOBILE_CODE = JSON.stringify({ summary: 'Booking app home screen', patches: [{ op: 'update', path: 'app/index.tsx', content: "import { Text, View } from 'react-native';\nimport { theme } from '@/lib/theme';\n\nexport default function Home() {\n  return <View style={{ flex: 1, padding: theme.space(6) }}><Text>Grand Lake rooms</Text></View>;\n}\n", reason: '' }] });

describe('App Studio (mobile apps)', () => {
  it('generates an Expo app, edits app.json settings directly as a version, and exports the source', async () => {
    await prisma.plan.update({ where: { code: 'free' }, data: { projectTypes: ['website', 'business_website', 'mobile_app'] } });
    const a = await login('app-maker');
    const id = await newProject(a.auth, 'mobile_app');
    const before = (await http().get(`${V}/projects/${id}/app-config`).set('Authorization', a.auth).expect(200)).body;
    expect(before.generated).toBe(false);
    provider.queue([JSON.stringify(SPEC), JSON.stringify(DESIGN), MOBILE_CODE]);
    const run = await generate(a.auth, id, 'A booking app for my lakeside hotel');
    expect(run.status).toBe(202);
    expect((await http().get(`${V}/generations/${run.body.id}`).set('Authorization', a.auth)).body.status).toBe('succeeded');
    const files = (await http().get(`${V}/projects/${id}/files`).set('Authorization', a.auth)).body.map((f: { path: string }) => f.path);
    expect(files).toEqual(expect.arrayContaining(['app.json', 'eas.json', 'app/_layout.tsx', 'app/index.tsx']));

    const cfg = (await http().get(`${V}/projects/${id}/app-config`).set('Authorization', a.auth).expect(200)).body;
    expect(cfg.config).toMatchObject({ name: 'My App', iosBundleId: 'com.example.myapp' });
    expect(cfg.checklist.find((c: { key: string }) => c.key === 'ids').done).toBe(false);
    expect(cfg.builds).toEqual({ available: false, reason: 'eas_not_connected' });

    const good = { name: 'Grand Lake', slug: 'grand-lake', version: '1.1.0', iosBundleId: 'com.grandlake.app', androidPackage: 'com.grandlake.app', primaryColor: '#0F4C5C', splashColor: '#F4F1EA', privacyPolicyUrl: 'https://grandlake.example/privacy' };
    await http().put(`${V}/projects/${id}/app-config`).set('Authorization', a.auth).send({ ...good, androidPackage: 'com.grand-lake.app' }).expect(400);
    await http().put(`${V}/projects/${id}/app-config`).set('Authorization', a.auth).send({ ...good, iosBundleId: 'grandlake' }).expect(400);
    const after = (await http().put(`${V}/projects/${id}/app-config`).set('Authorization', a.auth).send(good).expect(200)).body;
    expect(after.config).toMatchObject(good);
    expect(after.checklist.filter((c: { done: boolean }) => c.done).map((c: { key: string }) => c.key)).toEqual(['name', 'ids', 'version', 'privacy']);
    const appJson = JSON.parse((await http().get(`${V}/projects/${id}/file?path=app.json`).set('Authorization', a.auth)).body.content);
    expect(appJson.expo).toMatchObject({ name: 'Grand Lake', ios: { bundleIdentifier: 'com.grandlake.app', buildNumber: '2' }, android: { package: 'com.grandlake.app', versionCode: 2 } });
    const versions = (await http().get(`${V}/projects/${id}/versions`).set('Authorization', a.auth)).body;
    expect(versions[0]).toMatchObject({ message: 'Updated app settings in App Studio', isHead: true });

    const zip = await http().get(`${V}/projects/${id}/export`).set('Authorization', a.auth).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const buf = zip.body as Buffer;
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(buf.includes(Buffer.from('grand-lake/app.json'))).toBe(true);
    const b = await login('app-snoop');
    await http().get(`${V}/projects/${id}/export`).set('Authorization', b.auth).expect(404);
    await http().get(`${V}/projects/${id}/app-config`).set('Authorization', b.auth).expect(404);
    // Websites can't be deployed as apps and vice versa.
    await http().post(`${V}/projects/${id}/deployments`).set('Authorization', a.auth).expect((r) => expect([400, 402, 503]).toContain(r.status));
  });
});
