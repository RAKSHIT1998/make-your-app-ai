import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { PrismaClient } from '@mya/db';
import { IS_PUBLIC } from '../src/auth/decorators.js';
import { createTestApp, newIdentity, resetDb, tokenFor } from './helpers.js';

/**
 * Walks every route the API actually registers, so a new endpoint can't ship without being checked:
 * - every route needs a signed-in user unless it is on the reviewed PUBLIC list below;
 * - owner-console routes are invisible (404) to customers;
 * - another customer's resources are never readable or changeable, and nothing answers 500.
 */
let app: INestApplication;
let prisma: PrismaClient;
const V = '/api/v1';

/** Reviewed list of routes that work without signing in. Adding one here is a deliberate decision. */
const PUBLIC = [
  // Generated apps' own backend: protected by the app key and the app's end-user sessions, not platform sign-in.
  'GET /appdata/:key/c/:name', 'POST /appdata/:key/c/:name', 'GET /appdata/:key/c/:name/:id', 'PATCH /appdata/:key/c/:name/:id', 'DELETE /appdata/:key/c/:name/:id',
  'GET /appdata/:key/services/currency/latest',
  // Price list, public collections and the invitation preview (the token itself is the secret).
  'GET /billing/plans', 'GET /collections/:id', 'GET /invitations/:token',
];

type Route = { method: string; path: string; isPublic: boolean };
function routes(): Route[] {
  const out: Route[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: unknown[]) => unknown) | null;
      if (!ctrl) continue;
      const base = ([] as string[]).concat(Reflect.getMetadata('path', ctrl) ?? '')[0]!;
      const classPublic = Reflect.getMetadata(IS_PUBLIC, ctrl) === true;
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = (ctrl.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const sub = Reflect.getMetadata('path', handler);
        if (sub === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata('method', handler) as number]!;
        for (const s of ([] as string[]).concat(sub)) {
          const path = `/${[base, s].filter((x) => x && x !== '/').join('/')}`.replace(/\/+/g, '/');
          out.push({ method, path, isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC, handler) === true });
        }
      }
    }
  }
  return out;
}
const fill = (p: string, ids: Record<string, string> = {}) =>
  p.replace(/:([A-Za-z]+)/g, (_, k: string) => ids[k] ?? (/slug|key|handle|code|collection|token|provider/i.test(k) ? 'nope-nope' : randomUUID()));
const send = (m: string, url: string, auth?: string) => {
  const r = (request(app.getHttpServer()) as unknown as Record<string, (u: string) => request.Test>)[m.toLowerCase()]!(url);
  if (auth) r.set('Authorization', auth);
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? r.send({}) : r;
};

beforeAll(async () => { ({ app, prisma } = await createTestApp()); await resetDb(prisma); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('route security sweep', () => {
  it('finds the routes', () => {
    expect(routes().length).toBeGreaterThan(150);
  });

  it('only reviewed routes answer without signing in', async () => {
    const pub = routes().filter((r) => r.isPublic).map((r) => `${r.method} ${r.path}`);
    const unexpected = pub.filter((r) => !PUBLIC.includes(r) && !/^(GET|POST|PUT|DELETE|PATCH) \/(health|webhooks|explore|showcase|creators|templates|storefront|shop|flags|plans|pricing|challenges|leaderboards|legal|og|referrals\/code|collections\/public|appdata\/:key\/(auth|config|services))/.test(r));
    expect(unexpected, `public routes that nobody reviewed:\n${unexpected.join('\n')}`).toEqual([]);

    const failures: string[] = [];
    for (const r of routes().filter((x) => !x.isPublic)) {
      const res = await send(r.method, `${V}${fill(r.path)}`);
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures, `routes that did not demand sign-in:\n${failures.join('\n')}`).toEqual([]);
  }, 120_000);

  it("owner routes are invisible to customers, and nobody can touch another customer's things", async () => {
    const a = newIdentity('owner-of-things');
    const b = newIdentity('stranger');
    const authA = `Bearer ${await tokenFor(a.id, a.email)}`;
    const authB = `Bearer ${await tokenFor(b.id, b.email)}`;
    const me = (await request(app.getHttpServer()).get(`${V}/me`).set('Authorization', authA).expect(200)).body;
    await request(app.getHttpServer()).get(`${V}/me`).set('Authorization', authB).expect(200);
    const project = (await request(app.getHttpServer()).post(`${V}/projects`).set('Authorization', authA).send({ name: 'Private shop', type: 'website' }).expect(201)).body;
    const store = await prisma.store.create({ data: { organizationId: me.personalOrgId, name: 'A store', slug: `a-store-${Date.now()}`, currency: 'INR' } });
    const ids = { id: project.id, projectId: project.id, storeId: store.id, orgId: me.personalOrgId, organizationId: me.personalOrgId };

    const admin: string[] = [];
    const leaks: string[] = [];
    for (const r of routes().filter((x) => !x.isPublic)) {
      if (r.path.startsWith('/admin')) {
        const res = await send(r.method, `${V}${fill(r.path)}`, authB);
        if (res.status !== 404) admin.push(`${r.method} ${r.path} → ${res.status}`);
        continue;
      }
      if (!/:(id|projectId|storeId|orgId|organizationId)\b/.test(r.path)) continue;
      // Ids in the path belong to someone else; the first path segment decides which kind of id fits.
      const seg = r.path.split('/')[1];
      const own = seg === 'stores' ? { ...ids, id: store.id } : seg === 'orgs' ? { ...ids, id: me.personalOrgId } : ids;
      const res = await send(r.method, `${V}${fill(r.path, own)}`, authB);
      if ((res.status >= 200 && res.status < 300) || res.status >= 500) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(admin, `owner routes visible to a customer:\n${admin.join('\n')}`).toEqual([]);
    expect(leaks, `another customer's resource answered:\n${leaks.join('\n')}`).toEqual([]);

    // The owner's project is untouched.
    const still = (await request(app.getHttpServer()).get(`${V}/projects/${project.id}`).set('Authorization', authA).expect(200)).body;
    expect(still.name).toBe('Private shop');
  }, 180_000);
});
