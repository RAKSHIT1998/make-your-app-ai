import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { createPrismaClient, type PrismaClient } from '@mya/db';
import { AppModule } from '../src/app.module.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';

export const JWT_SECRET = 'test-secret-at-least-32-characters-long!!';
export const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/mya_test';

export async function createTestApp(opts: { env?: Record<string, string>; overrides?: { provide: symbol; useValue: unknown }[] } = {}): Promise<{ app: INestApplication; prisma: PrismaClient }> {
  const storage = await mkdtemp(path.join(tmpdir(), 'mya-api-store-'));
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: DB_URL, SUPABASE_JWT_SECRET: JWT_SECRET, STORAGE_DIR: storage, SANDBOX_PROVIDER: 'none', ...opts.env });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config, opts.overrides ?? [])] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app, config);
  await app.init();
  return { app, prisma: createPrismaClient(DB_URL) };
}

/** Mints a token shaped like a Supabase Auth access token (HS256 legacy mode). */
export async function tokenFor(sub: string, email: string, opts: { secret?: string; aud?: string } = {}) {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(opts.secret ?? JWT_SECRET));
}

export function newIdentity(label: string) {
  const id = randomUUID();
  return { id, email: `${label}-${id.slice(0, 6)}@example.test` };
}

/**
 * Clean slate + a permissive Free plan so feature tests aren't constrained by plan limits.
 * Billing tests override plans explicitly.
 */
export async function resetDb(prisma: PrismaClient, free: { includedCredits?: number; maxProjects?: number; dailyCreditLimit?: number | null; maxCreditsPerRun?: number; projectTypes?: string[] } = {}) {
  await prisma.$executeRawUnsafe('TRUNCATE "User", "Organization", "Plan", "CreditPack", "AuditLog", "AiProviderConfig", "PaymentWebhookEvent" CASCADE');
  await prisma.plan.create({
    data: {
      code: 'free', name: 'Free', includedCredits: free.includedCredits ?? 200, maxProjects: free.maxProjects ?? 100, dailyCreditLimit: free.dailyCreditLimit ?? null,
      maxCreditsPerRun: free.maxCreditsPerRun ?? 500, featureFlags: [], projectTypes: free.projectTypes ?? ['website', 'business_website'],
    },
  });
}
