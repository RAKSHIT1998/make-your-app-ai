import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OPENAI_COMPATIBLE_PRESETS, routeKey, type ProviderRouter } from '@mya/ai';
import type { PrismaClient } from '@mya/db';
import { z } from 'zod';
import { AI_ROUTER, loadTierRates, refreshRouting } from '../ai/ai.providers.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';

const Tier = z.enum(['fast', 'balanced', 'deep']);
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
  ) {}

  async overview() {
    await loadTierRates(this.prisma); // seeds the reference rates on first use
    const [rows, rates, status, usage] = await Promise.all([
      this.prisma.aiProviderConfig.findMany({ orderBy: [{ tier: 'asc' }, { priority: 'asc' }] }),
      this.prisma.aiTierRate.findMany(),
      this.router.status(),
      this.prisma.aiUsage.groupBy({ by: ['provider', 'model'], where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, _sum: { costMicros: true, creditsCharged: true }, _count: { _all: true } }),
    ]);
    const registered = new Set(this.router.providerNames());
    const routes = rows.map((r) => {
      const key = routeKey(r);
      const st = status.find((s) => routeKey(s) === key);
      const u = usage.find((x) => routeKey(x) === key);
      const costUsd = Number(u?._sum.costMicros ?? 0n) / 1e6;
      const revenueUsd = (u?._sum.creditsCharged ?? 0) / this.config.CREDITS_PER_USD;
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
      providers: [...new Set([...Object.keys(OPENAI_COMPATIBLE_PRESETS), 'anthropic', ...(this.config.CUSTOM_AI_NAME ? [this.config.CUSTOM_AI_NAME] : [])])].sort().map((name) => ({ name, configured: registered.has(name) })),
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
