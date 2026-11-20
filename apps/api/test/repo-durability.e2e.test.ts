import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

let storage: string;
let appA: INestApplication;
let appB: INestApplication;
let prisma: PrismaClient;
const V = '/api/v1';

beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), 'mya-durable-'));
  // Two API instances with separate disks, like a redeploy or a second server.
  ({ app: appA, prisma } = await createTestApp({ env: { STORAGE_DIR: path.join(storage, 'a') } }));
  ({ app: appB } = await createTestApp({ env: { STORAGE_DIR: path.join(storage, 'b') } }));
});
afterAll(async () => { await appA.close(); await appB.close(); await prisma.$disconnect(); await rm(storage, { recursive: true, force: true }); });
beforeEach(() => resetDb(prisma));

describe('customer code survives losing the server disk', () => {
  it('files, versions, restore and publishing keep working after the disk is wiped and on another instance', async () => {
    const u = newIdentity('durable');
    const auth = `Bearer ${await tokenFor(u.id, u.email)}`;
    const id = (await request(appA.getHttpServer()).post(`${V}/projects`).set('Authorization', auth).send({ name: 'Durable game', type: 'game' }).expect(201)).body.id as string;
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    const gen = appA.get(GenerationsService);
    await gen.importTree(project, new Map([['index.html', '<!doctype html><title>One</title><h1>One</h1>']]), 'first');
    await gen.importTree(project, new Map([['index.html', '<!doctype html><title>Two</title><h1>Two</h1>'], ['app.js', 'let score = 0;']]), 'second');
    const row = await prisma.projectRepo.findUniqueOrThrow({ where: { projectId: id } });
    expect(row.sizeBytes).toBeGreaterThan(0);

    // Wipe instance A's disk completely.
    await rm(path.join(storage, 'a'), { recursive: true, force: true });
    const files = (await request(appA.getHttpServer()).get(`${V}/projects/${id}/files`).set('Authorization', auth).expect(200)).body as { path: string }[];
    expect(files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);

    // Instance B never had this project on disk: it reads it, restores v1 and publishes.
    const versions = (await request(appB.getHttpServer()).get(`${V}/projects/${id}/versions`).set('Authorization', auth).expect(200)).body as { id: string; number: number }[];
    expect(versions.map((v) => v.number).sort()).toEqual([1, 2]);
    const v1 = versions.find((v) => v.number === 1)!;
    await request(appB.getHttpServer()).post(`${V}/projects/${id}/versions/${v1.id}/restore`).set('Authorization', auth).expect(201);
    const file = (await request(appB.getHttpServer()).get(`${V}/projects/${id}/file?path=index.html`).set('Authorization', auth).expect(200)).body;
    expect(file.content).toContain('<h1>One</h1>');
    const pub = (await request(appB.getHttpServer()).put(`${V}/projects/${id}/publishing`).set('Authorization', auth).send({ visibility: 'public', publicTitle: 'Durable game' }).expect(200)).body;

    // A, which had restored the old head, catches up with B's restore before serving.
    const again = (await request(appA.getHttpServer()).get(`${V}/projects/${id}/file?path=index.html`).set('Authorization', auth).expect(200)).body;
    expect(again.content).toContain('<h1>One</h1>');
    await request(appA.getHttpServer()).get(`${V}/showcase/${pub.slug}/play`).expect(200);
    expect(await readdir(path.join(storage, 'a'))).toContain(id);
  });
});
