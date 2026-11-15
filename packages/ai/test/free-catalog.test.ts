import { describe, expect, it } from 'vitest';
import { DiscoveryError, FREE_PROVIDERS, ProviderRouter, ScriptedProvider, discoverFreeModels } from '../src/index.js';

const stub = (routes: Record<string, { status?: number; json: unknown }>) => {
  const calls: { url: string; auth: string | null }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, auth: (init?.headers as Record<string, string>)?.authorization ?? null });
    const hit = Object.entries(routes).find(([k]) => u.startsWith(k));
    return new Response(JSON.stringify(hit?.[1].json ?? {}), { status: hit ? (hit[1].status ?? 200) : 404 });
  }) as typeof fetch;
  return { f, calls };
};

describe('free provider catalogue', () => {
  it('describes every provider with its signup page and env keys', () => {
    expect(FREE_PROVIDERS.map((p) => p.key)).toEqual(['groq', 'cerebras', 'openrouter', 'gemini', 'chutes', 'cloudflare', 'sambanova']);
    for (const p of FREE_PROVIDERS) { expect(p.signupUrl).toMatch(/^https:\/\//); expect(p.env.length).toBeGreaterThan(0); }
  });

  it('keeps only free OpenRouter models, including the free router', async () => {
    const { f, calls } = stub({ 'https://openrouter.ai/api/v1/models': { json: { data: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' }, context_length: 131072 },
      { id: 'openai/gpt-5', pricing: { prompt: '0.00000125', completion: '0.00001' } },
      { id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } },
      { id: 'some/embedding-model:free', pricing: { prompt: '0', completion: '0' } },
    ] } } });
    const m = await discoverFreeModels('openrouter', { apiKey: 'or-key' }, f);
    expect(m).toEqual([{ id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: 'free', contextWindow: 131072 }, { id: 'openrouter/free', pricing: 'free', contextWindow: null }]);
    expect(calls[0]!.auth).toBe('Bearer or-key');
  });

  it('offers only Chutes models priced at exactly $0 (Chutes is pay-as-you-go)', async () => {
    const { f, calls } = stub({ 'https://llm.chutes.ai/v1/models': { json: { data: [
      { id: 'zai-org/GLM-4.5-Air-TEE', pricing: { prompt: 0, completion: 0, input_cache_read: 0 }, context_length: 131072 },
      { id: 'deepseek-ai/DeepSeek-V3.2-TEE', pricing: { prompt: 0.25, completion: 0.38 }, context_length: 163840 },
      { id: 'Qwen/Qwen3-8B-TEE', pricing: { prompt: 0, completion: 0.05 } },
      { id: 'unknown/no-price-listed' },
      { id: 'BAAI/bge-m3-embedding', pricing: { prompt: 0, completion: 0 } },
    ] } } });
    expect(await discoverFreeModels('chutes', { apiKey: 'cpk_test' }, f)).toEqual([{ id: 'zai-org/GLM-4.5-Air-TEE', pricing: 'free', contextWindow: 131072 }]);
    expect(calls[0]).toEqual({ url: 'https://llm.chutes.ai/v1/models', auth: 'Bearer cpk_test' });
  });

  it('lists active chat models on free-tier providers and skips audio, guard and embedding models', async () => {
    const { f } = stub({ 'https://api.groq.com/openai/v1/models': { json: { data: [
      { id: 'openai/gpt-oss-120b', active: true, context_window: 131072 }, { id: 'whisper-large-v3', active: true }, { id: 'meta-llama/llama-guard-4-12b', active: true }, { id: 'old-model', active: false },
    ] } } });
    expect((await discoverFreeModels('groq', { apiKey: 'k' }, f)).map((m) => m.id)).toEqual(['openai/gpt-oss-120b']);
    const g = stub({ 'https://generativelanguage.googleapis.com/v1beta/openai/models': { json: { data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/text-embedding-004' }, { id: 'models/imagen-4' }] } } });
    expect((await discoverFreeModels('gemini', { apiKey: 'k' }, g.f)).map((m) => m.id)).toEqual(['gemini-2.5-flash']);
    const cf = stub({ 'https://api.cloudflare.com/client/v4/accounts/acc1/ai/models/search': { json: { result: [{ name: '@cf/meta/llama-3.1-8b-instruct' }, { name: '@cf/baai/bge-large-en-v1.5' }] } } });
    expect((await discoverFreeModels('cloudflare', { apiKey: 'cf', accountId: 'acc1' }, cf.f)).map((m) => m.id)).toEqual(['@cf/meta/llama-3.1-8b-instruct']);
    const sn = stub({ 'https://api.sambanova.ai/v1/models': { json: { data: [{ id: 'DeepSeek-V3.1', context_length: 131072 }, { id: 'Whisper-Large-v3' }, { id: 'E5-Mistral-7B-Instruct-embedding' }] } } });
    expect(await discoverFreeModels('sambanova', { apiKey: 'sn' }, sn.f)).toEqual([{ id: 'DeepSeek-V3.1', pricing: 'free_tier', contextWindow: 131072 }]);
    expect(sn.calls[0]).toEqual({ url: 'https://api.sambanova.ai/v1/models', auth: 'Bearer sn' });
  });

  it('reports a rejected key clearly without echoing it', async () => {
    const { f } = stub({ 'https://api.cerebras.ai/v1/models': { status: 401, json: { message: 'bad' } } });
    const e = await discoverFreeModels('cerebras', { apiKey: 'secret-key-123' }, f).catch((x) => x);
    expect(e).toBeInstanceOf(DiscoveryError);
    expect(e.message).toBe('The provider rejected the API key.');
    expect(e.message).not.toContain('secret-key-123');
  });

  it('probes a route with one real call and checks the JSON', async () => {
    const good = new ProviderRouter([new ScriptedProvider('free', ['{"sum": 5}'])], []);
    expect(await good.probe('free', 'm')).toMatchObject({ ok: true, error: null });
    const bad = new ProviderRouter([new ScriptedProvider('free', ['five'])], []);
    expect((await bad.probe('free', 'm')).ok).toBe(false);
    expect((await bad.probe('nokey', 'm')).error).toMatch(/No API key/);
  });
});
