export type ModelTier = 'fast' | 'balanced' | 'deep';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  /** JSON Schema for native structured output. Adapters without support fall back to prompt instructions. */
  jsonSchema?: Record<string, unknown>;
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  latencyMs: number;
}

export interface ModelCapabilities {
  structuredOutput: boolean;
  maxOutputTokens: number;
}

export interface AiProvider {
  readonly name: string;
  capabilities(model: string): ModelCapabilities;
  complete(model: string, req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>;
}

/** One routable model with its pricing (USD micros per million tokens). */
export interface ModelRoute {
  provider: string;
  model: string;
  tier: ModelTier;
  priority: number;
  inputCostPerMTokMicros: number;
  outputCostPerMTokMicros: number;
  enabled: boolean;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class NoRouteError extends Error {
  constructor(tier: ModelTier) {
    super(`No enabled model route for tier "${tier}"`);
    this.name = 'NoRouteError';
  }
}
