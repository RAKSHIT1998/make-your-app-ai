import { AnthropicProvider, DEFAULT_ROUTES, ProviderRouter, type AiProvider, type ModelRoute, type ModelTier } from '@mya/ai';
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
  const fromDb: ModelRoute[] = rows.map((r) => ({ provider: r.provider, model: r.model, tier: r.tier as ModelTier, priority: r.priority, inputCostPerMTokMicros: r.inputCostPerMTokMicros, outputCostPerMTokMicros: r.outputCostPerMTokMicros, enabled: r.enabled }));
  const fallbacks = DEFAULT_ROUTES.filter((r) => r.priority !== 10 && fromDb.some((d) => d.model === r.model && d.enabled));
  return [...fromDb, ...fallbacks];
}

export const aiProviders = [
  {
    provide: AI_ROUTER,
    inject: [APP_CONFIG, PRISMA],
    useFactory: async (config: AppConfig, prisma: PrismaClient) => {
      const providers: AiProvider[] = [];
      if (config.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY }));
      return new ProviderRouter(providers, await loadRoutes(prisma));
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
