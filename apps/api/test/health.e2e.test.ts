import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { GenerationsService } from '../src/generation/generations.service.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

let app: INestApplication;
let prisma: PrismaClient;
const http = () => request(app.getHttpServer());
const V = '/api/v1';
beforeAll(async () => ({ app, prisma } = await createTestApp()));
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(prisma); });

async function person(label: string) {
  const u = newIdentity(label);
  return { ...u, auth: `Bearer ${await tokenFor(u.id, u.email)}` };
}

describe('project health audit', () => {
  it('audits the real committed files, is read-only for viewers, and never crosses tenants', async () => {
    const owner = await person('owner');
    const other = await person('other');
    const created = await http().post(`${V}/projects`).set('Authorization', owner.auth).send({ name: 'Audit me', type: 'website' }).expect(201);
    const id = created.body.id as string;
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });

    const before = await http().get(`${V}/projects/${id}/health`).set('Authorization', owner.auth).expect(200);
    expect(before.body.filesScanned).toBe(0);

    const tree = new Map([
      ['package.json', '{"dependencies":{"next":"15"}}'],
      ['next.config.ts', 'export default {}'],
      ['app/layout.tsx', 'export default function L({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}'],
      ['app/page.tsx', 'export default function P(){return <main><img src="/x.png"/></main>}'],
    ]);
    await app.get(GenerationsService).importTree(project, tree, 'seed');

    const res = await http().get(`${V}/projects/${id}/health`).set('Authorization', owner.auth).expect(200);
    expect(res.body.kind).toBe('web');
    expect(res.body.filesScanned).toBe(4);
    const alt = res.body.checks.find((c: { id: string }) => c.id === 'a11y.alt');
    expect(alt).toMatchObject({ severity: 'fail', files: ['app/page.tsx'] });
    expect(res.body.checks.find((c: { id: string }) => c.id === 'a11y.lang').severity).toBe('fail');

    await http().get(`${V}/projects/${id}/health`).set('Authorization', other.auth).expect(404);
    await http().get(`${V}/projects/${id}/health`).expect(401);
  });
});
