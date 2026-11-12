import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import type { PrismaClient } from '@mya/db';

/**
 * Fixed-window request counters in Postgres so every API instance enforces one shared limit.
 * One atomic upsert per request. If the database is unreachable the request is allowed (fail open): the same outage
 * would fail the request anyway, and a limiter must not turn a database blip into a full outage.
 */
export class PostgresThrottlerStorage implements ThrottlerStorage {
  private readonly log = new Logger('RateLimit');
  private lastSweep = 0;

  constructor(private readonly prisma: PrismaClient) {}

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const k = `${throttlerName}:${key}`;
    try {
      const [row] = await this.prisma.$queryRaw<{ hits: number; ttl: number }[]>`
        INSERT INTO "RateLimitHit" ("key", "hits", "expiresAt") VALUES (${k}, 1, now() + (${ttl}::int * interval '1 millisecond'))
        ON CONFLICT ("key") DO UPDATE SET
          "hits" = CASE WHEN "RateLimitHit"."expiresAt" <= now() THEN 1 ELSE "RateLimitHit"."hits" + 1 END,
          "expiresAt" = CASE WHEN "RateLimitHit"."expiresAt" <= now() THEN now() + (${ttl}::int * interval '1 millisecond') ELSE "RateLimitHit"."expiresAt" END
        RETURNING "hits", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - now()))))::int AS "ttl"`;
      void this.sweepSometimes();
      const remaining = row?.ttl ?? Math.ceil(ttl / 1000);
      const hits = row?.hits ?? 1;
      return { totalHits: hits, timeToExpire: remaining, isBlocked: hits > limit, timeToBlockExpire: hits > limit ? remaining : 0 };
    } catch (e) {
      this.log.warn(`limiter unavailable, allowing request: ${e instanceof Error ? e.message : e}`);
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  /** Expired windows are dead weight; whichever instance notices first (at most once a minute each) clears them. */
  private async sweepSometimes() {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    await this.prisma.$executeRaw`DELETE FROM "RateLimitHit" WHERE "expiresAt" < now() - interval '1 minute'`.catch(() => undefined);
  }
}
