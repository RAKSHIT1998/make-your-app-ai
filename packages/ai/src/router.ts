import { BudgetExceededError, NoRouteError, ProviderError, type AiProvider, type CompletionRequest, type CompletionResult, type ModelRoute, type ModelTier, type RouteWindowStats, type TierRate } from './types.js';

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** What this attempt cost us (USD micros, at the route's own price). */
  costMicros: number;
  /** What the customer is charged for it: the tier's standard rate, whatever model served it. */
  chargeMicros: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface RouterCallOptions {
  tier: ModelTier;
  signal?: AbortSignal;
  /** Called before every attempt with the worst-case amount the customer could be charged. Throw BudgetExceededError to stop. */
  checkBudget?: (worstCaseMicros: number) => Promise<void> | void;
  /** Called after every attempt, successful or not. */
  onUsage?: (u: UsageRecord) => Promise<void> | void;
}

export type RoutingStrategy = 'priority' | 'margin';

export interface RouterOptions {
  maxAttemptsPerRoute?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** priority: admin order only (default). margin: lowest expected cost that meets the tier's quality floor. */
  strategy?: RoutingStrategy;
  /** Customer-facing price per tier. Without it the customer is charged each route's own price. */
  tierRates?: Partial<Record<ModelTier, TierRate>>;
  /** Minimum route quality per tier. */
  minQuality?: Partial<Record<ModelTier, number>>;
  /** Rolling usage per "provider:model" from the shared metering table. */
  loadStats?: () => Promise<Map<string, RouteWindowStats>>;
  statsTtlMs?: number;
  now?: () => number;
  /** Consecutive failures before a route is taken out of rotation, and how long (doubles per trip). */
  breaker?: { threshold?: number; baseOpenMs?: number; maxOpenMs?: number };
}

export const DEFAULT_MIN_QUALITY: Record<ModelTier, number> = { fast: 40, balanced: 70, deep: 90 };

export function costMicros(route: Pick<ModelRoute, 'inputCostPerMTokMicros' | 'outputCostPerMTokMicros'>, inTok: number, outTok: number): number {
  return Math.ceil((inTok * route.inputCostPerMTokMicros + outTok * route.outputCostPerMTokMicros) / 1_000_000);
}

/** Rough input token estimate (≈4 chars/token) used only for pre-call budget checks. */
export function estimateInputTokens(req: CompletionRequest): number {
  const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0) + JSON.stringify(req.jsonSchema ?? '').length;
  return Math.ceil(chars / 4);
}

export const routeKey = (r: Pick<ModelRoute, 'provider' | 'model'>) => `${r.provider}:${r.model}`;

interface Health {
  consecutive: number;
  trips: number;
  openUntil: number;
  /** EWMA of "output passed schema validation" for this instance. */
  validity: number;
  localRequests: number;
  localTokens: number;
}

export interface RouteStatus {
  provider: string;
  model: string;
  tier: ModelTier;
  circuitOpenUntil: number | null;
  validity: number;
  window: RouteWindowStats;
}

export class ProviderRouter {
  private readonly providers = new Map<string, AiProvider>();
  private readonly maxAttempts: number;
  private readonly backoff: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private strategy: RoutingStrategy;
  private tierRates: Partial<Record<ModelTier, TierRate>>;
  private readonly minQuality: Record<ModelTier, number>;
  private readonly loadStats: (() => Promise<Map<string, RouteWindowStats>>) | undefined;
  private readonly statsTtl: number;
  private readonly breaker: { threshold: number; baseOpenMs: number; maxOpenMs: number };
  private health = new Map<string, Health>();
  private stats = { at: 0, map: new Map<string, RouteWindowStats>() };

  constructor(
    providers: AiProvider[],
    private routes: ModelRoute[],
    opts: RouterOptions = {},
  ) {
    for (const p of providers) this.providers.set(p.name, p);
    this.maxAttempts = opts.maxAttemptsPerRoute ?? 3;
    this.backoff = opts.baseBackoffMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.strategy = opts.strategy ?? 'priority';
    this.tierRates = opts.tierRates ?? {};
    this.minQuality = { ...DEFAULT_MIN_QUALITY, ...opts.minQuality };
    this.loadStats = opts.loadStats;
    this.statsTtl = opts.statsTtlMs ?? 30_000;
    this.breaker = { threshold: opts.breaker?.threshold ?? 3, baseOpenMs: opts.breaker?.baseOpenMs ?? 60_000, maxOpenMs: opts.breaker?.maxOpenMs ?? 10 * 60_000 };
  }

  setRoutes(routes: ModelRoute[]) {
    this.routes = routes;
  }
  setTierRates(rates: Partial<Record<ModelTier, TierRate>>) {
    this.tierRates = rates;
  }
  setStrategy(s: RoutingStrategy) {
    this.strategy = s;
  }
  hasProvider(name: string) {
    return this.providers.has(name);
  }
  providerNames() {
    return [...this.providers.keys()];
  }

  /** Enabled routes for a tier whose provider is registered, in admin priority order (no health or cost logic). */
  candidates(tier: ModelTier): ModelRoute[] {
    return this.routes.filter((r) => r.enabled && r.tier === tier && this.providers.has(r.provider)).sort((a, b) => a.priority - b.priority);
  }

  private h(key: string): Health {
    let v = this.health.get(key);
    if (!v) this.health.set(key, (v = { consecutive: 0, trips: 0, openUntil: 0, validity: 1, localRequests: 0, localTokens: 0 }));
    return v;
  }

  private async window(): Promise<Map<string, RouteWindowStats>> {
    if (!this.loadStats) return this.stats.map;
    if (this.now() - this.stats.at > this.statsTtl) {
      try {
        this.stats = { at: this.now(), map: await this.loadStats() };
        for (const h of this.health.values()) { h.localRequests = 0; h.localTokens = 0; }
      } catch {
        this.stats = { ...this.stats, at: this.now() }; // keep the last picture; retry after the TTL
      }
    }
    return this.stats.map;
  }

  private usageToday(r: ModelRoute, w: Map<string, RouteWindowStats>) {
    const base = w.get(routeKey(r));
    const h = this.health.get(routeKey(r));
    return { requests: (base?.requestsToday ?? 0) + (h?.localRequests ?? 0), tokens: (base?.tokensToday ?? 0) + (h?.localTokens ?? 0) };
  }

  private reliability(r: ModelRoute, w: Map<string, RouteWindowStats>): number {
    const s = w.get(routeKey(r));
    const delivered = s && s.requests24h >= 5 ? s.successes24h / s.requests24h : 0.95;
    return Math.max(0.05, Math.min(1, delivered * this.h(routeKey(r)).validity));
  }

  /** Routes to try for this request, best first. Routes that exhausted their daily cap are never used. */
  async rank(tier: ModelTier, req: CompletionRequest): Promise<ModelRoute[]> {
    const w = await this.window();
    const t = this.now();
    const inTok = estimateInputTokens(req);
    const eligible = this.candidates(tier).filter((r) => (r.quality ?? 100) >= this.minQuality[tier]);
    const withinCaps = eligible.filter((r) => {
      const u = this.usageToday(r, w);
      return (r.dailyRequestLimit == null || u.requests < r.dailyRequestLimit) && (r.dailyTokenLimit == null || u.tokens + inTok + req.maxOutputTokens <= r.dailyTokenLimit);
    });
    const healthy = withinCaps.filter((r) => this.h(routeKey(r)).openUntil <= t);
    const tripped = withinCaps.filter((r) => this.h(routeKey(r)).openUntil > t).sort((a, b) => this.h(routeKey(a)).openUntil - this.h(routeKey(b)).openUntil);
    if (this.strategy === 'priority') return [...healthy, ...tripped];

    const outTok = Math.min(req.maxOutputTokens, 4000);
    const rate = this.tierRates[tier];
    const fallbackCost = costMicros(rate ?? { inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 }, inTok, outTok);
    const score = (r: ModelRoute) => costMicros(r, inTok, outTok) + (1 - this.reliability(r, w)) * fallbackCost;
    const ordered = healthy
      .map((r) => ({ r, s: score(r) }))
      .sort((a, b) => a.s - b.s || (b.r.quality ?? 100) - (a.r.quality ?? 100) || a.r.priority - b.r.priority)
      .map((x) => x.r);
    return [...ordered, ...tripped];
  }

  /** Called by agent code when a response did or did not pass schema validation, so bad models fall out of rotation. */
  reportOutput(provider: string, model: string, valid: boolean) {
    const h = this.h(`${provider}:${model}`);
    h.validity = Math.max(0.05, Math.min(1, h.validity * 0.8 + (valid ? 1 : 0) * 0.2));
  }

  private noteFailure(key: string, e: unknown) {
    const h = this.h(key);
    const status = e instanceof ProviderError ? e.status : undefined;
    const t = this.now();
    if (status === 401 || status === 403 || status === 404) {
      h.openUntil = t + this.breaker.maxOpenMs; // misconfigured key or model: stop trying until fixed or the window passes
      return;
    }
    if (!(e instanceof ProviderError && e.retryable)) return; // request-specific failure: not the route's fault
    if (++h.consecutive >= this.breaker.threshold) {
      h.openUntil = t + Math.min(this.breaker.maxOpenMs, this.breaker.baseOpenMs * 2 ** h.trips);
      h.trips++;
      h.consecutive = 0;
    }
  }

  private noteSuccess(key: string, tokens: number) {
    const h = this.h(key);
    h.consecutive = 0;
    h.trips = 0;
    h.openUntil = 0;
    h.localRequests++;
    h.localTokens += tokens;
  }

  /** Live view for the Owner console. */
  async status(): Promise<RouteStatus[]> {
    const w = await this.window();
    return this.routes.map((r) => {
      const h = this.health.get(routeKey(r));
      const u = this.usageToday(r, w);
      const base = w.get(routeKey(r));
      return { provider: r.provider, model: r.model, tier: r.tier, circuitOpenUntil: h && h.openUntil > this.now() ? h.openUntil : null, validity: h?.validity ?? 1, window: { requests24h: base?.requests24h ?? 0, successes24h: base?.successes24h ?? 0, requestsToday: u.requests, tokensToday: u.tokens } };
    });
  }

  async complete(req: CompletionRequest, opts: RouterCallOptions): Promise<CompletionResult & { costMicros: number; chargeMicros: number; routeModel: string }> {
    const ranked = await this.rank(opts.tier, req);
    if (ranked.length === 0) throw new NoRouteError(opts.tier);
    const rate = this.tierRates[opts.tier];
    let lastError: unknown;

    for (const [idx, route] of ranked.entries()) {
      const provider = this.providers.get(route.provider)!;
      const key = routeKey(route);
      const maxOut = Math.min(req.maxOutputTokens, provider.capabilities(route.model).maxOutputTokens);
      const routedReq = { ...req, maxOutputTokens: maxOut };
      const hasNext = idx < ranked.length - 1;

      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        await opts.checkBudget?.(costMicros(rate ?? route, estimateInputTokens(routedReq), maxOut));
        try {
          const res = await provider.complete(route.model, routedReq, opts.signal);
          const cost = costMicros(route, res.inputTokens, res.outputTokens);
          const charge = rate ? costMicros(rate, res.inputTokens, res.outputTokens) : cost;
          this.noteSuccess(key, res.inputTokens + res.outputTokens);
          await opts.onUsage?.({ provider: route.provider, model: route.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costMicros: cost, chargeMicros: charge, latencyMs: res.latencyMs, success: true });
          return { ...res, costMicros: cost, chargeMicros: charge, routeModel: route.model };
        } catch (e) {
          if (e instanceof BudgetExceededError) throw e;
          lastError = e;
          this.noteFailure(key, e);
          await opts.onUsage?.({ provider: route.provider, model: route.model, inputTokens: 0, outputTokens: 0, costMicros: 0, chargeMicros: 0, latencyMs: 0, success: false, error: e instanceof Error ? e.message : String(e) });
          const retryable = e instanceof ProviderError && e.retryable;
          if (!retryable) break; // non-retryable on this route → try the next provider/model
          if (e instanceof ProviderError && e.status === 429 && hasNext) break; // rate limited: move on instead of waiting
          if (this.h(key).openUntil > this.now() && hasNext) break; // route just tripped its breaker
          if (attempt < this.maxAttempts) await this.sleep(this.backoff * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All model routes failed');
  }
}
