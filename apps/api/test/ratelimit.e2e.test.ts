import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@mya/db';
import { createTestApp } from './helpers.js';

let app: INestApplication;
let prisma: PrismaClient;
beforeAll(async () => ({ app, prisma } = await createTestApp({ env: { RATE_LIMIT_PER_MINUTE: '3', CHECKOUT_RATE_LIMIT_PER_MINUTE: '2' } })));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

it('rate-limits clients with a structured 429', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await request(app.getHttpServer()).get('/api/v1/health')).status);
  expect(codes).toEqual([200, 200, 200, 429, 429]);
  const res = await request(app.getHttpServer()).get('/api/v1/health');
  expect(res.body).toMatchObject({ statusCode: 429, error: 'TooManyRequests' });
});

it('applies the tighter per-route limit to storefront checkout', async () => {
  const hit = () => request(app.getHttpServer()).post('/api/v1/storefront/no-such-store/checkout').set('x-forwarded-for', '10.9.9.9').send({});
  const codes = [(await hit()).status, (await hit()).status, (await hit()).status];
  expect(codes).toEqual([400, 400, 429]);
});
