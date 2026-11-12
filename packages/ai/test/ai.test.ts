import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider, BudgetExceededError, ProviderError, ProviderRouter, ScriptedProvider, extractJson, toProviderJsonSchema, type ModelRoute } from '../src/index.js';

const route = (provider: string, model: string, priority = 10): ModelRoute => ({ provider, model, tier: 'balanced', priority, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true });
const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], maxOutputTokens: 1000 };
const noSleep = { sleep: async () => {} };

describe('ProviderRouter', () => {
  it('retries retryable errors on the same route, then succeeds and meters every attempt', async () => {
    const p = new ScriptedProvider('a', [new ProviderError('overloaded', 'a', true, 529), 'ok']);
    const usage: boolean[] = [];
    const r = new ProviderRouter([p], [route('a', 'm1')], noSleep);
    const res = await r.complete(req, { tier: 'balanced', onUsage: (u) => void usage.push(u.success) });
    expect(res.text).toBe('ok');
    expect(usage).toEqual([false, true]);
    expect(res.costMicros).toBeGreaterThan(0);
  });

  it('falls back to the next provider when one is down', async () => {
    const a = new ScriptedProvider('a', [new ProviderError('500', 'a', true), new ProviderError('500', 'a', true)]);
    const b = new ScriptedProvider('b', ['from b']);
    const r = new ProviderRouter([a, b], [route('a', 'm1', 1), route('b', 'm2', 2)], { ...noSleep, maxAttemptsPerRoute: 2 });
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('b');
    expect(a.calls).toHaveLength(2);
  });

  it('does not retry non-retryable errors on the same route', async () => {
    const a = new ScriptedProvider('a', [new ProviderError('bad request', 'a', false, 400)]);
    const r = new ProviderRouter([a], [route('a', 'm1')], noSleep);
    await expect(r.complete(req, { tier: 'balanced' })).rejects.toThrow('bad request');
    expect(a.calls).toHaveLength(1);
  });

  it('enforces the budget before calling the model', async () => {
    const a = new ScriptedProvider('a', ['never']);
    const r = new ProviderRouter([a], [route('a', 'm1')], noSleep);
    await expect(
      r.complete(req, { tier: 'balanced', checkBudget: () => { throw new BudgetExceededError('limit'); } }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(a.calls).toHaveLength(0);
  });

  it('computes cost from tokens and route pricing', async () => {
    const r = new ProviderRouter([new ScriptedProvider('a', ['x'])], [route('a', 'm')], noSleep);
    const res = await r.complete(req, { tier: 'balanced' });
    expect(res.costMicros).toBe(Math.ceil((res.inputTokens * 2_000_000 + res.outputTokens * 10_000_000) / 1e6));
  });

  it('skips disabled routes and unregistered providers', async () => {
    const r = new ProviderRouter([new ScriptedProvider('a', [])], [{ ...route('a', 'm'), enabled: false }, route('zzz', 'm')], noSleep);
    await expect(r.complete(req, { tier: 'balanced' })).rejects.toThrow('No enabled model route');
  });
});

describe('AnthropicProvider', () => {
  function fakeFetch(status: number, body: unknown, seen: { url?: string; body?: any }) {
    return (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
    }) as typeof fetch;
  }

  it('sends structured-output requests and parses text + usage', async () => {
    const seen: { url?: string; body?: any } = {};
    const p = new AnthropicProvider({
      apiKey: 'test-key',
      fetch: fakeFetch(200, {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: '{"ok":true}' }],
        usage: { input_tokens: 12, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
      }, seen),
    });
    const res = await p.complete('claude-sonnet-5-5', { ...req, jsonSchema: { type: 'object' } });
    expect(seen.url).toContain('/v1/messages');
    expect(seen.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 1000, system: 'sys', output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } });
    expect(res).toMatchObject({ text: '{"ok":true}', inputTokens: 15, outputTokens: 5, stopReason: 'end_turn' });
  });

  it('maps HTTP errors to retryable / non-retryable ProviderErrors', async () => {
    const err = (status: number) => new AnthropicProvider({ apiKey: 'k', fetch: fakeFetch(status, { type: 'error', error: { type: 'x', message: 'boom' } }, {}) });
    await expect(err(429).complete('claude-sonnet-5-5', req)).rejects.toMatchObject({ retryable: true, status: 429 });
    await expect(err(529).complete('claude-sonnet-5-5', req)).rejects.toMatchObject({ retryable: true });
    await expect(err(400).complete('claude-sonnet-5-5', req)).rejects.toMatchObject({ retryable: false, status: 400 });
  });
});

describe('json helpers', () => {
  it('closes objects and strips constraints for provider schemas', () => {
    const s = toProviderJsonSchema(z.object({ name: z.string().min(1).max(5), tags: z.array(z.object({ k: z.string() })) }));
    expect(s).toMatchObject({ type: 'object', additionalProperties: false });
    expect((s as any).properties.name.minLength).toBeUndefined();
    expect((s as any).properties.tags.items.additionalProperties).toBe(false);
    expect(s['$schema']).toBeUndefined();
  });
  it('extracts JSON from fenced or chatty output', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => extractJson('nope')).toThrow();
  });
});
