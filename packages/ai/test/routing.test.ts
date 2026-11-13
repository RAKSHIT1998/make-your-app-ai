import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider, ProviderError, ProviderRouter, ScriptedProvider, routeKey, type ModelRoute, type RouteWindowStats, type UsageRecord } from '../src/index.js';

const mk = (provider: string, model: string, over: Partial<ModelRoute> = {}): ModelRoute => ({ provider, model, tier: 'balanced', priority: 10, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true, ...over });
const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'hello there' }], maxOutputTokens: 1000 };
const RATE = { balanced: { inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000 } };
const base = { sleep: async () => {}, strategy: 'margin' as const, tierRates: RATE };

describe('margin routing', () => {
  it('uses the free route first, charges the customer the tier rate, and records the real cost as 0', async () => {
    const paid = new ScriptedProvider('paid', ['p']);
    const free = new ScriptedProvider('free', ['f']);
    const r = new ProviderRouter([paid, free], [mk('paid', 'big', { priority: 1 }), mk('free', 'open', { priority: 50, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 })], base);
    const usage: UsageRecord[] = [];
    const res = await r.complete(req, { tier: 'balanced', onUsage: (u) => void usage.push(u) });
    expect(res.provider).toBe('free');
    expect(res.costMicros).toBe(0);
    expect(res.chargeMicros).toBeGreaterThan(0);
    expect(usage[0]).toMatchObject({ provider: 'free', costMicros: 0 });
    expect(usage[0]!.chargeMicros).toBe(res.chargeMicros);
    expect(paid.calls).toHaveLength(0);
  });

  it('priority strategy keeps the admin order (cheapest is not forced)', async () => {
    const r = new ProviderRouter([new ScriptedProvider('paid', ['p']), new ScriptedProvider('free', ['f'])], [mk('paid', 'big', { priority: 1 }), mk('free', 'open', { priority: 50, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 })], { ...base, strategy: 'priority' });
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('paid');
  });

  it('never uses a route below the tier quality floor, even if it is free', async () => {
    const r = new ProviderRouter([new ScriptedProvider('paid', ['p']), new ScriptedProvider('weak', ['w'])], [mk('paid', 'big'), mk('weak', 'tiny', { quality: 40, inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 })], base);
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('paid');
  });

  it('prefers a slightly dearer route when the cheap one keeps failing in the shared stats', async () => {
    const stats = new Map<string, RouteWindowStats>([[routeKey({ provider: 'flaky', model: 'm' }), { requests24h: 100, successes24h: 20, requestsToday: 100, tokensToday: 0 }]]);
    const r = new ProviderRouter(
      [new ScriptedProvider('flaky', ['x']), new ScriptedProvider('steady', ['y'])],
      [mk('flaky', 'm', { inputCostPerMTokMicros: 200_000, outputCostPerMTokMicros: 1_000_000 }), mk('steady', 'm', { inputCostPerMTokMicros: 400_000, outputCostPerMTokMicros: 2_000_000 })],
      { ...base, loadStats: async () => stats },
    );
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('steady');
  });

  it('stops using a free route once its daily request cap is reached (from the shared stats), then falls back', async () => {
    const stats = new Map<string, RouteWindowStats>([[routeKey({ provider: 'free', model: 'open' }), { requests24h: 30, successes24h: 30, requestsToday: 30, tokensToday: 1000 }]]);
    const r = new ProviderRouter([new ScriptedProvider('free', ['f']), new ScriptedProvider('paid', ['p'])], [mk('free', 'open', { inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0, dailyRequestLimit: 30 }), mk('paid', 'big')], { ...base, loadStats: async () => stats });
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('paid');
  });

  it('counts its own requests between stat refreshes, so a cap holds under load', async () => {
    const free = new ScriptedProvider('free', ['1', '2']);
    const r = new ProviderRouter([free, new ScriptedProvider('paid', ['p'])], [mk('free', 'open', { inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0, dailyRequestLimit: 2 }), mk('paid', 'big')], { ...base, loadStats: async () => new Map() });
    const got = [];
    for (let i = 0; i < 3; i++) got.push((await r.complete(req, { tier: 'balanced' })).provider);
    expect(got).toEqual(['free', 'free', 'paid']);
  });

  it('skips a rate-limited free route immediately instead of backing off, and trips the breaker after repeated failures', async () => {
    let t = 0;
    const slept: number[] = [];
    const free = new ScriptedProvider('free', [new ProviderError('429', 'free', true, 429), new ProviderError('429', 'free', true, 429), new ProviderError('429', 'free', true, 429), 'late']);
    const paid = new ScriptedProvider('paid', ['a', 'b', 'c', 'd']);
    const r = new ProviderRouter([free, paid], [mk('free', 'open', { inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 }), mk('paid', 'big')], { ...base, now: () => t, sleep: async (ms) => void slept.push(ms) });
    for (let i = 0; i < 3; i++) expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('paid');
    expect(slept).toEqual([]);
    expect(free.calls).toHaveLength(3);
    // breaker is open: the free route is not even tried
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('paid');
    expect(free.calls).toHaveLength(3);
    // after the cool-down it is tried again and recovers
    t += 61_000;
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('free');
  });

  it('takes a route with a bad key out of rotation (401) without retrying it', async () => {
    const bad = new ScriptedProvider('bad', [new ProviderError('unauthorized', 'bad', false, 401), 'never']);
    const r = new ProviderRouter([bad, new ScriptedProvider('ok', ['1', '2'])], [mk('bad', 'm', { inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 }), mk('ok', 'm')], base);
    await r.complete(req, { tier: 'balanced' });
    await r.complete(req, { tier: 'balanced' });
    expect(bad.calls).toHaveLength(1);
  });

  it('demotes a route whose answers keep failing schema validation', async () => {
    const r = new ProviderRouter([new ScriptedProvider('cheap', ['a', 'b']), new ScriptedProvider('steady', ['c', 'd'])], [mk('cheap', 'm', { inputCostPerMTokMicros: 100_000, outputCostPerMTokMicros: 500_000 }), mk('steady', 'm', { inputCostPerMTokMicros: 300_000, outputCostPerMTokMicros: 1_500_000 })], base);
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('cheap');
    for (let i = 0; i < 12; i++) r.reportOutput('cheap', 'm', false);
    expect((await r.complete(req, { tier: 'balanced' })).provider).toBe('steady');
  });

  it('charges the budget guard at the tier rate, not the route price', async () => {
    const seen: number[] = [];
    const r = new ProviderRouter([new ScriptedProvider('free', ['f'])], [mk('free', 'open', { inputCostPerMTokMicros: 0, outputCostPerMTokMicros: 0 })], base);
    await r.complete(req, { tier: 'balanced', checkBudget: (w) => void seen.push(w) });
    expect(seen[0]).toBeGreaterThan(5000); // 1000 output tokens at $10/M
  });
});

describe('OpenAiCompatibleProvider', () => {
  const ok = (body: unknown, status = 200) => Response.json(body, { status });
  it('sends an OpenAI-style request and maps usage, model and text', async () => {
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | undefined;
    const p = new OpenAiCompatibleProvider({
      name: 'groq', apiKey: 'k_test', baseURL: 'https://api.example.test/openai/v1/',
      fetch: (async (url: string, init: RequestInit) => { seen = { url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body as string) }; return ok({ model: 'llama-x', choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5 } }); }) as unknown as typeof fetch,
    });
    const res = await p.complete('llama-x', { ...req, jsonSchema: { type: 'object' } });
    expect(seen!.url).toBe('https://api.example.test/openai/v1/chat/completions');
    expect(seen!.auth).toBe('Bearer k_test');
    expect(seen!.body).toMatchObject({ model: 'llama-x', response_format: { type: 'json_object' } });
    expect(JSON.stringify(seen!.body.messages)).toContain('JSON Schema');
    expect(res).toMatchObject({ text: '{"a":1}', provider: 'groq', inputTokens: 12, outputTokens: 5, stopReason: 'stop' });
  });
  it.each([[429, true], [503, true], [401, false], [400, false]])('maps HTTP %i to retryable=%s and never leaks the key', async (status, retryable) => {
    const p = new OpenAiCompatibleProvider({ name: 'g', apiKey: 'k_secret', baseURL: 'https://x.test/v1', fetch: (async () => ok({ error: { message: 'nope' } }, status)) as unknown as typeof fetch });
    const e = await p.complete('m', req).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.retryable).toBe(retryable);
    expect(e.status).toBe(status);
    expect(e.message).not.toContain('k_secret');
  });
  it('treats a network failure as retryable and an empty body as an error', async () => {
    const down = new OpenAiCompatibleProvider({ name: 'g', apiKey: 'k', baseURL: 'https://x.test/v1', fetch: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch });
    expect(await down.complete('m', req).catch((x) => x)).toMatchObject({ retryable: true });
    const empty = new OpenAiCompatibleProvider({ name: 'g', apiKey: 'k', baseURL: 'https://x.test/v1', fetch: (async () => ok({ choices: [] })) as unknown as typeof fetch });
    expect(await empty.complete('m', req).catch((x) => x)).toBeInstanceOf(ProviderError);
  });
});
