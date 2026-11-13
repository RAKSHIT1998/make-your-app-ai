import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DiscoveryError, FREE_PROVIDERS, OPENAI_COMPATIBLE_PRESETS, discoverFreeModels, routeKey, type DiscoveredModel, type ProviderRouter } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { z } from 'zod';
import { AI_ROUTER, loadTierRates, refreshRouting } from '../ai/ai.providers.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';

const Tier = z.enum(['fast', 'balanced', 'deep']);
/** fetch used to list providers' models (replaced in tests; the sandboxed test environment has no internet). */
export const DISCOVERY_FETCH = Symbol('DISCOVERY_FETCH');
export const discoveryFetchProvider = { provide: DISCOVERY_FETCH, useValue: (...a: Parameters<typeof fetch>) => fetch(...a) };
const DISCOVERY_TTL_MS = 10 * 60_000;
export const RouteInput = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{2,30}$/),
  model: z.string().trim().min(1).max(120),
  tier: Tier,
  priority: z.number().int().min(0).max(1000).default(100),
  enabled: z.boolean().default(true),
  inputCostPerMTokMicros: z.number().int().min(0).max(1_000_000_000),
  outputCostPerMTokMicros: z.number().int().min(0).max(1_000_000_000),
  quality: z.number().int().min(0).max(100).default(100),
  dailyRequestLimit: z.number().int().min(1).nullable().default(null),
  dailyTokenLimit: z.number().int().min(1).nullable().default(null),
});
export const TierRateInput = z.object({ inputCostPerMTokMicros: z.number().int().min(0).max(1_000_000_000), outputCostPerMTokMicros: z.number().int().min(0).max(1_000_000_000) });

/** Owner console: which models serve each tier, what they cost us, what customers pay, and the margin per route. */
@Injectable()
export class AiRoutingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_ROUTER) private readonly router: ProviderRouter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DISCOVERY_FETCH) private readonly discoveryFetch: typeof fetch,
  ) {}

  private readonly discovered = new Map<string, { at: number; models: DiscoveredModel[] }>();

  private credsFor(provider: string): { apiKey: string; accountId?: string } | null {
    const c = this.config;
    const key: Record<string, string | undefined> = { groq: c.GROQ_API_KEY, cerebras: c.CEREBRAS_API_KEY, openrouter: c.OPENROUTER_API_KEY, gemini: c.GEMINI_API_KEY, cloudflare: c.CLOUDFLARE_ACCOUNT_ID ? c.CLOUDFLARE_API_TOKEN : undefined };
    const apiKey = key[provider];
    return apiKey ? { apiKey, ...(provider === 'cloudflare' ? { accountId: c.CLOUDFLARE_ACCOUNT_ID! } : {}) } : null;
  }

  /**
   * Free providers with their published free tier, whether a key is set, and (when it is) the models the provider
   * offers for free right now, discovered live from its API. Nothing is invented: no key, no model list.
   */
  async freeCatalog(refresh = false) {
    const routes = await this.prisma.aiProviderConfig.findMany({ select: { provider: true, model: true, tier: true, enabled: true } });
    return Promise.all(FREE_PROVIDERS.map(async (p) => {
      const creds = this.credsFor(p.key);
      const base = { ...p, configured: !!creds && this.router.hasProvider(p.key), models: [] as (DiscoveredModel & { route: { tier: string; enabled: boolean } | null })[], error: null as string | null, checkedAt: null as string | null };
      if (!creds) return base;
      let hit = this.discovered.get(p.key);
      if (refresh || !hit || Date.now() - hit.at > DISCOVERY_TTL_MS) {
        try {
          hit = { at: Date.now(), models: await discoverFreeModels(p.key, creds, this.discoveryFetch) };
          this.discovered.set(p.key, hit);
        } catch (e) {
          return { ...base, error: e instanceof DiscoveryError ? e.message : 'Could not list models.' };
        }
      }
      return { ...base, checkedAt: new Date(hit.at).toISOString(), models: hit.models.map((m) => { const r = routes.find((x) => x.provider === p.key && x.model === m.id); return { ...m, route: r ? { tier: r.tier, enabled: r.enabled } : null }; }) };
    }));
  }

  /** One small real call through the provider to check the key, the model and JSON output before customers use it. */
  async testRoute(admin: AuthUser, provider: string, model: string) {
    const r = await this.router.probe(provider, model);
    await this.audit.record({ action: 'admin.ai_route_tested', actorId: admin.id, targetType: 'ai_route', metadata: { provider, model, ok: r.ok, latencyMs: r.latencyMs } });
    return r;
  }

  async overview() {
    await loadTierRates(this.prisma); // seeds the reference rates on first use
    const since = new Date(Date.now() - 24 * 3600_000);
    const [rows, rates, status, usage, refunded] = await Promise.all([
      this.prisma.aiProviderConfig.findMany({ orderBy: [{ tier: 'asc' }, { priority: 'asc' }] }),
      this.prisma.aiTierRate.findMany(),
      this.router.status(),
      this.prisma.aiUsage.groupBy({ by: ['provider', 'model'], where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, _sum: { costMicros: true, creditsCharged: true }, _count: { _all: true } }),
      // Credits handed back by the failed-build guarantee are not revenue; the route's cost still is a cost.
      this.prisma.$queryRaw<{ provider: string; model: string; credits: bigint }[]>`
        SELECT u."provider"::text AS provider, u."model" AS model, COALESCE(SUM(u."creditsCharged"), 0)::bigint AS credits
        FROM "AiUsage" u JOIN "GenerationRun" r ON r."id" = u."generationRunId"
        WHERE r."creditsRefunded" > 0 AND u."createdAt" >= ${since}
        GROUP BY 1, 2`,
    ]);
    const registered = new Set(this.router.providerNames());
    const routes = rows.map((r) => {
      const key = routeKey(r);
      const st = status.find((s) => routeKey(s) === key);
      const u = usage.find((x) => routeKey(x) === key);
      const costUsd = Number(u?._sum.costMicros ?? 0n) / 1e6;
      const back = Number(refunded.find((x) => routeKey(x) === key)?.credits ?? 0n);
      const revenueUsd = Math.max(0, (u?._sum.creditsCharged ?? 0) - back) / this.config.CREDITS_PER_USD;
      return {
        id: r.id, provider: r.provider, model: r.model, tier: r.tier, priority: r.priority, enabled: r.enabled,
        inputCostPerMTokMicros: r.inputCostPerMTokMicros, outputCostPerMTokMicros: r.outputCostPerMTokMicros,
        quality: r.quality, dailyRequestLimit: r.dailyRequestLimit, dailyTokenLimit: r.dailyTokenLimit,
        providerConfigured: registered.has(r.provider),
        circuitOpenUntil: st?.circuitOpenUntil ? new Date(st.circuitOpenUntil).toISOString() : null,
        validity: Math.round((st?.validity ?? 1) * 100),
        requests24h: st?.window.requests24h ?? 0, successes24h: st?.window.successes24h ?? 0, requestsToday: st?.window.requestsToday ?? 0, tokensToday: st?.window.tokensToday ?? 0,
        costUsd24h: Math.round(costUsd * 10_000) / 10_000, revenueUsd24h: Math.round(revenueUsd * 10_000) / 10_000, marginUsd24h: Math.round((revenueUsd - costUsd) * 10_000) / 10_000,
      };
    });
    return {
      strategy: this.config.AI_ROUTING_STRATEGY,
      creditsPerUsd: this.config.CREDITS_PER_USD,
      providers: [...new Set([...Object.keys(OPENAI_COMPATIBLE_PRESETS), 'anthropic', 'cloudflare', ...(this.config.CUSTOM_AI_NAME ? [this.config.CUSTOM_AI_NAME] : [])])].sort().map((name) => ({ name, configured: registered.has(name) })),
      tierRates: rates.map((r) => ({ tier: r.tier, inputCostPerMTokMicros: r.inputCostPerMTokMicros, outputCostPerMTokMicros: r.outputCostPerMTokMicros })),
      routes,
      totals: { costUsd24h: round(routes.reduce((n, r) => n + r.costUsd24h, 0)), revenueUsd24h: round(routes.reduce((n, r) => n + r.revenueUsd24h, 0)), marginUsd24h: round(routes.reduce((n, r) => n + r.marginUsd24h, 0)) },
    };
  }

  async upsertRoute(admin: AuthUser, input: z.infer<typeof RouteInput>) {
    const row = await this.prisma.aiProviderConfig.upsert({ where: { provider_model: { provider: input.provider, model: input.model } }, create: input, update: input });
    await refreshRouting(this.router, this.prisma);
    await this.audit.record({ action: 'admin.ai_route_saved', actorId: admin.id, targetType: 'ai_route', targetId: row.id, metadata: input as never });
    return this.overview();
  }

  async deleteRoute(admin: AuthUser, id: string) {
    const row = await this.prisma.aiProviderConfig.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Route not found');
    await this.prisma.aiProviderConfig.delete({ where: { id } });
    await refreshRouting(this.router, this.prisma);
    await this.audit.record({ action: 'admin.ai_route_deleted', actorId: admin.id, targetType: 'ai_route', targetId: id, metadata: { provider: row.provider, model: row.model, tier: row.tier } });
    return this.overview();
  }

  async setTierRate(admin: AuthUser, tier: z.infer<typeof Tier>, input: z.infer<typeof TierRateInput>) {
    await this.prisma.aiTierRate.upsert({ where: { tier }, create: { tier, ...input }, update: input });
    await refreshRouting(this.router, this.prisma);
    await this.audit.record({ action: 'admin.ai_tier_rate_saved', actorId: admin.id, targetType: 'ai_tier', targetId: tier, metadata: input });
    return this.overview();
  }
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
export { Tier as AiTier };
