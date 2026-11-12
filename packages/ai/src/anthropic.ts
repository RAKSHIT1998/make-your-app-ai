import Anthropic, { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { ProviderError, type AiProvider, type CompletionRequest, type CompletionResult, type ModelCapabilities } from './types.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Models known to support `output_config.format` structured outputs. Unknown models fall back to prompt-only JSON. */
const STRUCTURED_OUTPUT_PREFIXES = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5', 'claude-fable-5', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-7', 'claude-opus-4-8'];

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      timeout: opts.timeoutMs ?? 10 * 60_000,
      maxRetries: 0, // retries are owned by the router so every attempt is metered
    });
  }

  capabilities(model: string): ModelCapabilities {
    return {
      structuredOutput: STRUCTURED_OUTPUT_PREFIXES.some((p) => model.startsWith(p)),
      maxOutputTokens: 64_000,
    };
  }

  async complete(model: string, req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const started = Date.now();
    const useSchema = req.jsonSchema && this.capabilities(model).structuredOutput;
    try {
      const res = await this.client.messages.create(
        {
          model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(useSchema ? { output_config: { format: { type: 'json_schema' as const, schema: req.jsonSchema! } } } : {}),
        },
        signal ? { signal } : undefined,
      );
      const text = res.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        provider: this.name,
        model: res.model,
        inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
        outputTokens: res.usage.output_tokens,
        stopReason: res.stop_reason ?? null,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      if (e instanceof APIConnectionError) throw new ProviderError(e.message, this.name, true);
      if (e instanceof APIError) {
        const status = e.status ?? 0;
        const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
        throw new ProviderError(e.message, this.name, retryable, status);
      }
      throw e;
    }
  }
}
