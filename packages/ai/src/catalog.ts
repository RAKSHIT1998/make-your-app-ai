import type { ModelRoute } from './types.js';

/**
 * Default routes, used to seed AiProviderConfig. Admins edit these in the DB — this is not the runtime source of truth.
 * Anthropic list prices (USD per 1M tokens) as of Nov 2026: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 (≤100k-token prompts).
 */
export const DEFAULT_ROUTES: ModelRoute[] = [
  { provider: 'anthropic', model: 'claude-haiku-5-5', tier: 'fast', priority: 10, inputCostPerMTokMicros: 100_000, outputCostPerMTokMicros: 500_000, enabled: true },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', tier: 'balanced', priority: 10, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true },
  { provider: 'anthropic', model: 'claude-opus-5-5', tier: 'deep', priority: 10, inputCostPerMTokMicros: 4_000_000, outputCostPerMTokMicros: 20_000_000, enabled: true },
  // Fallbacks within the same vendor until other adapters land.
  { provider: 'anthropic', model: 'claude-opus-5-5', tier: 'balanced', priority: 50, inputCostPerMTokMicros: 4_000_000, outputCostPerMTokMicros: 20_000_000, enabled: true },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', tier: 'deep', priority: 50, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true },
];
