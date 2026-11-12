import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

// Two API instances, one database: the setup behind running more than one replica.
let a: INestApplication;
let b: INestApplication;
let prisma: PrismaClient;
const env = { RATE_LIMIT_STORE: 'postgres', RATE_LIMIT_PER_MINUTE: '4', RUN_LEASE_SECONDS: '60', TRUST_PROXY: '1' };

beforeAll(async () => {
  ({ app: a, prisma } = await createTestApp({ env }));
  ({ app: b } = await createTestApp({ env }));
});
afterAll(async () => {
  await a.close();
  await b.close();
  await prisma.$disconnect();
});
beforeEach(() => resetDb(prisma));

describe('shared rate limits (RATE_LIMIT_STORE=postgres)', () => {
  it('counts requests across instances, and different clients independently', async () => {
    const hit = (app: INestApplication, ip: string) => request(app.getHttpServer()).get('/api/v1/health/live').set('x-forwarded-for', ip);
    // 4 allowed per minute per client in total, however the load balancer spreads them.
    const codes = [(await hit(a, '10.1.1.1')).status, (await hit(b, '10.1.1.1')).status, (await hit(a, '10.1.1.1')).status, (await hit(b, '10.1.1.1')).status];
    expect(codes).toEqual([200, 200, 200, 200]);
    const over = await hit(a, '10.1.1.1');
    expect(over.status).toBe(429);
    expect((await hit(b, '10.1.1.1')).status).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();
    // Another client is unaffected.
    expect((await hit(b, '10.2.2.2')).status).toBe(200);
  });

  it('starts a fresh window once the old one expires, and sweeps expired rows', async () => {
    const hit = () => request(a.getHttpServer()).get('/api/v1/health/live').set('x-forwarded-for', '10.3.3.3');
    for (let i = 0; i < 4; i++) await hit();
    expect((await hit()).status).toBe(429);
    await prisma.$executeRawUnsafe(`UPDATE "RateLimitHit" SET "expiresAt" = now() - interval '1 second'`);
    expect((await hit()).status).toBe(200);
    expect(await prisma.rateLimitHit.count({ where: { hits: { gt: 1 } } })).toBe(0);
  });
});

describe('run leases', () => {
  async function seed() {
    const u = newIdentity('lease');
    const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
    await request(a.getHttpServer()).get('/api/v1/me').set('Authorization', auth).set('x-forwarded-for', '10.9.0.1').expect(200);
    const project = (await request(a.getHttpServer()).post('/api/v1/projects').set('Authorization', auth).set('x-forwarded-for', '10.9.0.1').send({ name: 'Lease', type: 'website' }).expect(201)).body;
    await prisma.project.update({ where: { id: project.id }, data: { status: 'generating' } });
    const mk = (data: object) => prisma.generationRun.create({ data: { projectId: project.id, requestedBy: u.id, kind: 'create', prompt: 'x', status: 'running', ...data } });
    return { project, mk };
  }
  const old = () => new Date(Date.now() - 5 * 60_000);

  it('an instance only fails runs whose owner stopped renewing', async () => {
    const { project, mk } = await seed();
    const svcA = a.get(GenerationsService);
    const dead = await mk({ workerId: 'crashed', heartbeatAt: old() });
    const orphan = await mk({ workerId: null, heartbeatAt: null, createdAt: old() });
    const alive = await mk({ workerId: 'instance-b', heartbeatAt: new Date() });
    expect(await svcA.recoverAbandoned()).toBe(2);
    const status = async (id: string) => (await prisma.generationRun.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(dead.id)).toBe('failed');
    expect(await status(orphan.id)).toBe('failed');
    expect(await status(alive.id)).toBe('running');
    expect((await prisma.generationRun.findUniqueOrThrow({ where: { id: dead.id } })).error).toContain('Interrupted by a server restart');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('error');
    expect(await svcA.recoverAbandoned()).toBe(0); // idempotent
  });

  it('never fails a run this instance is still executing, and renewing the lease keeps it safe', async () => {
    const { mk } = await seed();
    const svcA = a.get(GenerationsService);
    const mine = await mk({ workerId: svcA.workerId, heartbeatAt: old() });
    (svcA as unknown as { inflight: Map<string, Promise<void>> }).inflight.set(mine.id, new Promise(() => undefined));
    try {
      expect(await svcA.recoverAbandoned()).toBe(0);
      await svcA.renewLeases();
      const renewed = await prisma.generationRun.findUniqueOrThrow({ where: { id: mine.id } });
      expect(renewed.status).toBe('running');
      expect(Date.now() - renewed.heartbeatAt!.getTime()).toBeLessThan(10_000);
      // Another instance sees the fresh lease and leaves it alone too.
      expect(await b.get(GenerationsService).recoverAbandoned()).toBe(0);
    } finally {
      (svcA as unknown as { inflight: Map<string, Promise<void>> }).inflight.delete(mine.id);
    }
  });

  it('two instances recovering at once fail each run exactly once', async () => {
    const { mk } = await seed();
    const dead = await Promise.all([mk({ workerId: 'x', heartbeatAt: old() }), mk({ workerId: 'y', heartbeatAt: old() })]);
    const [n1, n2] = await Promise.all([a.get(GenerationsService).recoverAbandoned(), b.get(GenerationsService).recoverAbandoned()]);
    expect(n1 + n2).toBe(2);
    expect(await prisma.agentEvent.count({ where: { generationRunId: { in: dead.map((d) => d.id) }, type: 'run.failed' } })).toBe(2);
  });
});
