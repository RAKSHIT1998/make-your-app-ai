import { ProviderError, type AiProvider, type CompletionRequest, type CompletionResult, type ModelCapabilities } from './types.js';

export type FakeReply = string | ProviderError | ((req: CompletionRequest) => string);

/**
 * Deterministic provider for tests and offline development. Clearly not a real model:
 * it replays scripted replies in order. Never registered in production config.
 */
export class ScriptedProvider implements AiProvider {
  readonly calls: { model: string; req: CompletionRequest }[] = [];
  constructor(
    readonly name: string,
    private readonly replies: FakeReply[],
    private readonly caps: ModelCapabilities = { structuredOutput: true, maxOutputTokens: 32_000 },
  ) {}
  capabilities(): ModelCapabilities {
    return this.caps;
  }
  async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push({ model, req });
    const next = this.replies.shift();
    if (next === undefined) throw new ProviderError('ScriptedProvider ran out of replies', this.name, false);
    if (next instanceof ProviderError) throw next;
    const text = typeof next === 'function' ? next(req) : next;
    return { text, provider: this.name, model, inputTokens: Math.ceil(JSON.stringify(req).length / 4), outputTokens: Math.ceil(text.length / 4), stopReason: 'end_turn', latencyMs: 1 };
  }
}
