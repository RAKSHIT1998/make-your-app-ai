import { BudgetExceededError, NoRouteError, ProviderError, type AiProvider, type CompletionRequest, type CompletionResult, type ModelRoute, type ModelTier } from './types.js';

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface RouterCallOptions {
  tier: ModelTier;
  signal?: AbortSignal;
  /** Called before every attempt with a worst-case cost estimate. Throw BudgetExceededError to stop. */
  checkBudget?: (worstCaseMicros: number) => Promise<void> | void;
  /** Called after every attempt, successful or not. */
  onUsage?: (u: UsageRecord) => Promise<void> | void;
}

export interface RouterOptions {
  maxAttemptsPerRoute?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function costMicros(route: Pick<ModelRoute, 'inputCostPerMTokMicros' | 'outputCostPerMTokMicros'>, inTok: number, outTok: number): number {
  return Math.ceil((inTok * route.inputCostPerMTokMicros + outTok * route.outputCostPerMTokMicros) / 1_000_000);
}

/** Rough input token estimate (≈4 chars/token) used only for pre-call budget checks. */
export function estimateInputTokens(req: CompletionRequest): number {
  const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0) + JSON.stringify(req.jsonSchema ?? '').length;
  return Math.ceil(chars / 4);
}

export class ProviderRouter {
  private readonly providers = new Map<string, AiProvider>();
  private readonly maxAttempts: number;
  private readonly backoff: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    providers: AiProvider[],
    private routes: ModelRoute[],
    opts: RouterOptions = {},
  ) {
    for (const p of providers) this.providers.set(p.name, p);
    this.maxAttempts = opts.maxAttemptsPerRoute ?? 3;
    this.backoff = opts.baseBackoffMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  setRoutes(routes: ModelRoute[]) {
    this.routes = routes;
  }

  /** Enabled routes for a tier whose provider is registered, best first. */
  candidates(tier: ModelTier): ModelRoute[] {
    return this.routes
      .filter((r) => r.enabled && r.tier === tier && this.providers.has(r.provider))
      .sort((a, b) => a.priority - b.priority);
  }

  async complete(req: CompletionRequest, opts: RouterCallOptions): Promise<CompletionResult & { costMicros: number }> {
    const candidates = this.candidates(opts.tier);
    if (candidates.length === 0) throw new NoRouteError(opts.tier);
    let lastError: unknown;

    for (const route of candidates) {
      const provider = this.providers.get(route.provider)!;
      const maxOut = Math.min(req.maxOutputTokens, provider.capabilities(route.model).maxOutputTokens);
      const routedReq = { ...req, maxOutputTokens: maxOut };

      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        await opts.checkBudget?.(costMicros(route, estimateInputTokens(routedReq), maxOut));
        try {
          const res = await provider.complete(route.model, routedReq, opts.signal);
          const cost = costMicros(route, res.inputTokens, res.outputTokens);
          await opts.onUsage?.({ provider: route.provider, model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costMicros: cost, latencyMs: res.latencyMs, success: true });
          return { ...res, costMicros: cost };
        } catch (e) {
          if (e instanceof BudgetExceededError) throw e;
          lastError = e;
          await opts.onUsage?.({ provider: route.provider, model: route.model, inputTokens: 0, outputTokens: 0, costMicros: 0, latencyMs: 0, success: false, error: e instanceof Error ? e.message : String(e) });
          const retryable = e instanceof ProviderError && e.retryable;
          if (!retryable) break; // non-retryable on this route → try the next provider/model
          if (attempt < this.maxAttempts) await this.sleep(this.backoff * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All model routes failed');
  }
}
