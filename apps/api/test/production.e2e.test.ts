import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { loadConfig } from '../src/config.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

const base = { DATABASE_URL: 'postgresql://x', SUPABASE_URL: 'https://p.supabase.co' };
const prod = { ...base, NODE_ENV: 'production', ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), WEB_ORIGIN: 'https://makeyourapp.ai', WEB_APP_URL: 'https://makeyourapp.ai', PUBLIC_API_URL: 'https://api.makeyourapp.ai', STORAGE_DIR: '/data/projects', SANDBOX_PROVIDER: 'none' };

describe('production configuration', () => {
  it('accepts a complete production config and refuses unsafe ones without printing values', () => {
    expect(() => loadConfig(prod)).not.toThrow();
    const missingKey = { ...prod, ENCRYPTION_KEY: undefined };
    expect(() => loadConfig(missingKey)).toThrow(/ENCRYPTION_KEY is required in production/);
    expect(() => loadConfig({ ...prod, WEB_ORIGIN: 'http://localhost:3000' })).toThrow(/must be a public https/);
    expect(() => loadConfig({ ...prod, STORAGE_DIR: './.data' })).toThrow(/absolute path/);
    expect(() => loadConfig({ ...prod, SANDBOX_PROVIDER: 'local' })).toThrow(/development-only/);
    expect(() => loadConfig({ ...prod, HOSTING_PROVIDER: 'fake' })).toThrow(/development only/);
    try {
      loadConfig({ ...prod, ENCRYPTION_KEY: 'c2VjcmV0LXZhbHVlLXRoYXQtaXMtd3Jvbmc=' });
    } catch (e) {
      expect(String(e)).not.toContain('c2VjcmV0'); // values never echoed
    }
  });
});

describe('operations', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

  it('exposes liveness and readiness, and fails runs interrupted by a restart on boot', async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    const u = newIdentity('ops');
    const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
    await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', auth).expect(200);
    const project = (await request(app.getHttpServer()).post('/api/v1/projects').set('Authorization', auth).send({ name: 'Stuck', type: 'website' }).expect(201)).body;
    await prisma.project.update({ where: { id: project.id }, data: { status: 'generating' } });
    // One run whose owner died long ago, one that another (live) instance renewed a moment ago.
    const longAgo = new Date(Date.now() - 10 * 60_000);
    const run = await prisma.generationRun.create({ data: { projectId: project.id, requestedBy: u.id, kind: 'create', prompt: 'x', status: 'running', workerId: 'dead-instance', heartbeatAt: longAgo, createdAt: longAgo } });
    const live = await prisma.generationRun.create({ data: { projectId: project.id, requestedBy: u.id, kind: 'edit', prompt: 'y', status: 'running', workerId: 'live-instance', heartbeatAt: new Date() } });
    await app.close();
    await prisma.$disconnect();

    ({ app, prisma } = await createTestApp({ env: { RECOVER_INTERRUPTED_RUNS: 'true' } }));
    const http = () => request(app.getHttpServer());
    expect((await http().get('/api/v1/health/live').expect(200)).body.status).toBe('ok');
    expect((await http().get('/api/v1/health').expect(200)).body).toEqual({ status: 'ok', db: 'ok' });
    const after = await prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after).toMatchObject({ status: 'failed', error: expect.stringContaining('Interrupted by a server restart') });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('error');
    // A run that a live instance is still renewing is left alone (several instances share one database).
    expect((await prisma.generationRun.findUniqueOrThrow({ where: { id: live.id } })).status).toBe('running');
    // Security headers from helmet are on every response.
    const r = await http().get('/api/v1/health/live');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeDefined();
  });
});

describe('configuration errors', () => {
  it('lists every problem at once', () => {
    let msg = '';
    try { loadConfig({ DATABASE_URL: 'x', SUPABASE_URL: 'https://p.supabase.co', NODE_ENV: 'production' }); } catch (e) { msg = String(e); }
    for (const k of ['ENCRYPTION_KEY', 'WEB_ORIGIN', 'WEB_APP_URL', 'PUBLIC_API_URL', 'STORAGE_DIR', 'SANDBOX_PROVIDER']) expect(msg).toContain(k);
  });
});

describe('AI key sanity check', () => {
  const base = { DATABASE_URL: 'postgresql://x', SUPABASE_JWT_SECRET: 'x'.repeat(32) };
  it('rejects a Claude account sign-in token used as ANTHROPIC_API_KEY, without echoing it', () => {
    const token = 'sk-ant-usr-' + 'Q'.repeat(40);
    let msg = '';
    try { loadConfig({ ...base, ANTHROPIC_API_KEY: token }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/ANTHROPIC_API_KEY is not an API key/);
    expect(msg).not.toContain('QQQQ');
    expect(() => loadConfig({ ...base, ANTHROPIC_API_KEY: 'sk-ant-oat01-' + 'z'.repeat(30) })).toThrow(/not an API key/);
  });
  it('accepts a real-format API key', () => {
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'a'.repeat(40) }).ANTHROPIC_API_KEY).toMatch(/^sk-ant-api03-/);
  });
});
