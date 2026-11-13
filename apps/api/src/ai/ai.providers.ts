import { AnthropicProvider, DEFAULT_ROUTES, OPENAI_COMPATIBLE_PRESETS, OpenAiCompatibleProvider, ProviderRouter, routeKey, type AiProvider, type ModelRoute, type ModelTier, type RouteWindowStats, type TierRate } from '@mya/ai';
import { Orchestrator } from '@mya/agents';
import { GitProjectStore } from '@mya/codegen';
import { DockerSandbox, LocalProcessSandbox, type SandboxProvider } from '@mya/sandbox';
import type { PrismaClient } from '@mya/db';
import path from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PRISMA } from '../prisma.service.js';

export const AI_ROUTER = Symbol('AI_ROUTER');
export const ORCHESTRATOR = Symbol('ORCHESTRATOR');
export const PROJECT_STORE = Symbol('PROJECT_STORE');
export const SANDBOX = Symbol('SANDBOX');

/** Loads routes from AiProviderConfig (admin-editable), seeding defaults on first boot. */
export async function loadRoutes(prisma: PrismaClient): Promise<ModelRoute[]> {
  if ((await prisma.aiProviderConfig.count()) === 0) {
    // Same model may serve several tiers; the table is unique on (provider, model), so store its primary tier
    // and keep fallbacks in code until the admin console manages multi-tier routing.
    const primaries = DEFAULT_ROUTES.filter((r) => r.priority === 10);
    await prisma.aiProviderConfig.createMany({
      data: primaries.map((r) => ({ provider: r.provider, model: r.model, tier: r.tier, priority: r.priority, inputCostPerMTokMicros: r.inputCostPerMTokMicros, outputCostPerMTokMicros: r.outputCostPerMTokMicros })),
      skipDuplicates: true,
    });
  }
  const rows = await prisma.aiProviderConfig.findMany();
  const fromDb: ModelRoute[] = rows.map((r) => ({ provider: r.provider, model: r.model, tier: r.tier as ModelTier, priority: r.priority, inputCostPerMTokMicros: r.inputCostPerMTokMicros, outputCostPerMTokMicros: r.outputCostPerMTokMicros, enabled: r.enabled, quality: r.quality, dailyRequestLimit: r.dailyRequestLimit, dailyTokenLimit: r.dailyTokenLimit }));
  const fallbacks = DEFAULT_ROUTES.filter((r) => r.priority !== 10 && fromDb.some((d) => d.model === r.model && d.enabled));
  return [...fromDb, ...fallbacks];
}

/** Customer-facing price per tier. Seeded from the default reference models; editable in Owner console -> AI routing. */
export async function loadTierRates(prisma: PrismaClient): Promise<Record<string, TierRate>> {
  if ((await prisma.aiTierRate.count()) === 0) {
    await prisma.aiTierRate.createMany({
      data: DEFAULT_ROUTES.filter((r) => r.priority === 10).map((r) => ({ tier: r.tier, inputCostPerMTokMicros: r.inputCostPerMTokMicros, outputCostPerMTokMicros: r.outputCostPerMTokMicros })),
      skipDuplicates: true,
    });
  }
  const rows = await prisma.aiTierRate.findMany();
  return Object.fromEntries(rows.map((r) => [r.tier, { inputCostPerMTokMicros: r.inputCostPerMTokMicros, outputCostPerMTokMicros: r.outputCostPerMTokMicros }]));
}

/** Rolling usage per route from the metering table, so every API instance routes on the same numbers. */
export async function loadRouteStats(prisma: PrismaClient): Promise<Map<string, RouteWindowStats>> {
  const rows = await prisma.$queryRaw<{ provider: string; model: string; requests24h: bigint; successes24h: bigint; requestsToday: bigint; tokensToday: bigint }[]>`
    SELECT "provider", "model",
      COUNT(*) AS "requests24h",
      COUNT(*) FILTER (WHERE "success") AS "successes24h",
      COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS "requestsToday",
      COALESCE(SUM("inputTokens" + "outputTokens") FILTER (WHERE "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0) AS "tokensToday"
    FROM "AiUsage" WHERE "createdAt" >= now() - interval '24 hours' GROUP BY "provider", "model"`;
  return new Map(rows.map((r) => [routeKey(r), { requests24h: Number(r.requests24h), successes24h: Number(r.successes24h), requestsToday: Number(r.requestsToday), tokensToday: Number(r.tokensToday) }]));
}

/** Providers whose keys are configured. Nothing is registered without a real key. */
export function buildProviders(config: AppConfig): AiProvider[] {
  const providers: AiProvider[] = [];
  if (config.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY }));
  const keyed: [string, string | undefined][] = [['openai', config.OPENAI_API_KEY], ['groq', config.GROQ_API_KEY], ['openrouter', config.OPENROUTER_API_KEY], ['gemini', config.GEMINI_API_KEY], ['deepseek', config.DEEPSEEK_API_KEY], ['mistral', config.MISTRAL_API_KEY], ['together', config.TOGETHER_API_KEY]];
  for (const [name, apiKey] of keyed) if (apiKey) providers.push(new OpenAiCompatibleProvider({ name, apiKey, baseURL: OPENAI_COMPATIBLE_PRESETS[name]! }));
  if (config.CUSTOM_AI_NAME && config.CUSTOM_AI_BASE_URL) providers.push(new OpenAiCompatibleProvider({ name: config.CUSTOM_AI_NAME, apiKey: config.CUSTOM_AI_API_KEY ?? 'none', baseURL: config.CUSTOM_AI_BASE_URL }));
  return providers;
}

/** Reloads routes and customer rates after an Owner console change. */
export async function refreshRouting(router: ProviderRouter, prisma: PrismaClient) {
  router.setRoutes(await loadRoutes(prisma));
  router.setTierRates(await loadTierRates(prisma));
}

export const aiProviders = [
  {
    provide: AI_ROUTER,
    inject: [APP_CONFIG, PRISMA],
    useFactory: async (config: AppConfig, prisma: PrismaClient) => {
      return new ProviderRouter(buildProviders(config), await loadRoutes(prisma), { strategy: config.AI_ROUTING_STRATEGY, tierRates: await loadTierRates(prisma), loadStats: () => loadRouteStats(prisma) });
    },
  },
  {
    provide: PROJECT_STORE,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig) => new GitProjectStore(path.resolve(config.STORAGE_DIR)),
  },
  {
    provide: SANDBOX,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): SandboxProvider | null => {
      if (config.SANDBOX_PROVIDER === 'none') return null;
      if (config.SANDBOX_PROVIDER === 'docker') return new DockerSandbox({ image: config.SANDBOX_DOCKER_IMAGE, memory: '2g', cpus: '2', installNetwork: config.SANDBOX_DOCKER_INSTALL_NETWORK });
      return new LocalProcessSandbox();
    },
  },
  {
    provide: ORCHESTRATOR,
    inject: [PROJECT_STORE, SANDBOX],
    useFactory: (store: GitProjectStore, sandbox: SandboxProvider | null) => new Orchestrator({ store, ...(sandbox ? { sandbox } : {}) }),
  },
];
