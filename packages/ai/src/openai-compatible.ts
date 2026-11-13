import { ProviderError, type AiProvider, type CompletionRequest, type CompletionResult, type ModelCapabilities } from './types.js';

/**
 * Base URLs of OpenAI-compatible chat-completions APIs. These are endpoints only: model names, prices and free-tier
 * limits change often, so they are entered (and can be edited) in the Owner console, never hard-coded here.
 */
export const OPENAI_COMPATIBLE_PRESETS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.xyz/v1',
  cerebras: 'https://api.cerebras.ai/v1',
};

export interface OpenAiCompatibleOptions {
  /** Provider name used in routes, usage records and the Owner console (e.g. "groq"). */
  name: string;
  apiKey: string;
  baseURL: string;
  /** Extra headers some gateways want (OpenRouter attribution, for example). */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

/**
 * Adapter for any OpenAI-compatible /chat/completions endpoint (hosted free tiers, gateways, or a self-hosted
 * Ollama / vLLM). Structured output uses JSON mode plus the schema in the prompt; the caller validates the result.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  private readonly url: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly o: OpenAiCompatibleOptions) {
    this.name = o.name;
    this.url = `${o.baseURL.replace(/\/+$/, '')}/chat/completions`;
    this.doFetch = o.fetch ?? fetch;
  }

  capabilities(_model: string): ModelCapabilities {
    return { structuredOutput: false, maxOutputTokens: this.o.maxOutputTokens ?? 8_192 };
  }

  async complete(model: string, req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const started = Date.now();
    const system = req.jsonSchema ? `${req.system}\n\nReturn ONLY a JSON object that conforms to this JSON Schema:\n${JSON.stringify(req.jsonSchema)}` : req.system;
    const timeout = AbortSignal.timeout(this.o.timeoutMs ?? 5 * 60_000);
    let res: Response;
    try {
      res = await this.doFetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}`, ...this.o.headers },
        body: JSON.stringify({
          model,
          max_tokens: req.maxOutputTokens,
          messages: [{ role: 'system', content: system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
          ...(req.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ProviderError(`${this.name}: ${e instanceof Error ? e.message : 'network error'}`, this.name, true);
    }
    const bodyText = await res.text();
    if (!res.ok) {
      const retryable = res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500;
      throw new ProviderError(`${this.name} ${res.status}: ${bodyText.slice(0, 300)}`, this.name, retryable, res.status);
    }
    let json: { model?: string; choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new ProviderError(`${this.name}: response was not JSON`, this.name, true, res.status);
    }
    const choice = json.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== 'string') throw new ProviderError(`${this.name}: response had no message content`, this.name, true, res.status);
    return {
      text,
      provider: this.name,
      model: json.model ?? model,
      inputTokens: json.usage?.prompt_tokens ?? Math.ceil((system.length + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4),
      outputTokens: json.usage?.completion_tokens ?? Math.ceil(text.length / 4),
      stopReason: choice?.finish_reason ?? null,
      latencyMs: Date.now() - started,
    };
  }
}
