/**
 * Free AI providers the platform knows how to use. Endpoints and published free-tier terms only: which models are
 * free changes often, so models are discovered live from each provider's API with the owner's key, never hard-coded.
 * Limits below are the providers' published free-plan figures at the time of writing and are only defaults for new
 * routes; the owner can edit them, and the router also reacts to real 429 responses.
 */
export interface FreeProviderInfo {
  key: string;
  name: string;
  /** Environment variables that enable it. */
  env: string[];
  signupUrl: string;
  docsUrl: string;
  /** One-line summary of the free tier as published by the provider. */
  freeTier: string;
  /** Defaults for a new route: per-route daily caps (null = none). */
  defaults: { dailyRequestLimit: number | null; dailyTokenLimit: number | null };
  /** True when the free quota is shared by every model on the account, so one route per account is best. */
  accountWideQuota: boolean;
  /** What the provider says about using free-tier prompts (shown to the owner before enabling). */
  dataNote: string | null;
}

export const FREE_PROVIDERS: FreeProviderInfo[] = [
  {
    key: 'groq', name: 'Groq', env: ['GROQ_API_KEY'], signupUrl: 'https://console.groq.com/keys', docsUrl: 'https://console.groq.com/docs/rate-limits',
    freeTier: 'Free plan, no card. Per-model limits; for example about 30 requests/min, 1,000 requests/day and 200K tokens/day on large text models. Exact limits are on your console limits page.',
    defaults: { dailyRequestLimit: 1000, dailyTokenLimit: 200_000 }, accountWideQuota: false, dataNote: null,
  },
  {
    key: 'cerebras', name: 'Cerebras', env: ['CEREBRAS_API_KEY'], signupUrl: 'https://cloud.cerebras.ai', docsUrl: 'https://inference-docs.cerebras.ai/support/rate-limits',
    freeTier: 'Free tier, no card, around 1M tokens/day. Free-tier context windows are smaller than paid ones.',
    defaults: { dailyRequestLimit: null, dailyTokenLimit: 1_000_000 }, accountWideQuota: true, dataNote: null,
  },
  {
    key: 'openrouter', name: 'OpenRouter', env: ['OPENROUTER_API_KEY'], signupUrl: 'https://openrouter.ai/keys', docsUrl: 'https://openrouter.ai/docs/api-reference/limits',
    freeTier: 'Models ending in ":free" cost nothing: 20 requests/min and 50 requests/day for the whole account (1,000/day once you have bought $10 of credits). OpenRouter calls free models unsuitable for production.',
    defaults: { dailyRequestLimit: 50, dailyTokenLimit: null }, accountWideQuota: true,
    dataNote: 'Some free models are served by providers that may log or train on prompts. Check each model page.',
  },
  {
    key: 'gemini', name: 'Google Gemini (AI Studio)', env: ['GEMINI_API_KEY'], signupUrl: 'https://aistudio.google.com/apikey', docsUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    freeTier: 'Free tier with per-project limits shown at aistudio.google.com/rate-limit (Flash models around a few hundred requests/day). Not every model has a free tier.',
    defaults: { dailyRequestLimit: 200, dailyTokenLimit: null }, accountWideQuota: false,
    dataNote: 'On the free tier Google may use prompts and responses to improve its products. Your privacy policy must say so, or use the paid tier for customer data.',
  },
  {
    key: 'cloudflare', name: 'Cloudflare Workers AI', env: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], signupUrl: 'https://dash.cloudflare.com/profile/api-tokens', docsUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    freeTier: '10,000 Neurons/day free, shared across all models (resets 00:00 UTC). Small models stretch much further than large ones.',
    defaults: { dailyRequestLimit: null, dailyTokenLimit: null }, accountWideQuota: true, dataNote: null,
  },
];

export interface DiscoveredModel {
  id: string;
  /** "free": the provider marks it free; "free_tier": served under the account's free tier and limits. */
  pricing: 'free' | 'free_tier';
  contextWindow: number | null;
}

type Fetch = typeof fetch;
const BASES: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};
export const cloudflareBaseUrl = (accountId: string) => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`;

/** Chat-capable text models only: embeddings, speech, image, guard and moderation models are skipped. */
const NOT_CHAT = /(embed|whisper|tts|speech|audio|transcri|image|imagen|veo|vision-only|guard|moderation|rerank|aqa|clip|stable-diffusion|flux|lora|bge|m2m|resnet|detr|distilbert|-ocr|playai|orpheus)/i;

export class DiscoveryError extends Error {}

async function getJson(f: Fetch, url: string, token: string | null) {
  let res: Response;
  try {
    res = await f(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new DiscoveryError('Could not reach the provider.');
  }
  if (res.status === 401 || res.status === 403) throw new DiscoveryError('The provider rejected the API key.');
  if (!res.ok) throw new DiscoveryError(`The provider answered ${res.status}.`);
  try { return (await res.json()) as Record<string, unknown>; } catch { throw new DiscoveryError('The provider sent an unreadable model list.'); }
}

/** Lists the provider's current chat models that are free or covered by its free tier. Never includes the key in errors. */
export async function discoverFreeModels(provider: string, creds: { apiKey: string; accountId?: string }, f: Fetch = fetch): Promise<DiscoveredModel[]> {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  let out: DiscoveredModel[];
  if (provider === 'cloudflare') {
    if (!creds.accountId) throw new DiscoveryError('Set CLOUDFLARE_ACCOUNT_ID.');
    const j = await getJson(f, `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(creds.accountId)}/ai/models/search?task=Text%20Generation&per_page=200`, creds.apiKey);
    out = ((j.result as Record<string, unknown>[] | undefined) ?? []).map((m) => ({ id: String(m.name ?? ''), pricing: 'free_tier' as const, contextWindow: null }));
  } else if (BASES[provider]) {
    const j = await getJson(f, `${BASES[provider]}/models`, creds.apiKey);
    const data = (j.data as Record<string, unknown>[] | undefined) ?? [];
    out = data.flatMap((m): DiscoveredModel[] => {
      const id = String(m.id ?? '').replace(/^models\//, '');
      if (!id || m.active === false) return [];
      if (provider === 'openrouter') {
        const p = (m.pricing ?? {}) as Record<string, unknown>;
        const free = id.endsWith(':free') || id === 'openrouter/free' || (Number(p.prompt) === 0 && Number(p.completion) === 0 && p.prompt !== undefined);
        return free ? [{ id, pricing: 'free', contextWindow: num(m.context_length) }] : [];
      }
      return [{ id, pricing: 'free_tier', contextWindow: num(m.context_window) ?? num(m.context_length) }];
    });
  } else throw new DiscoveryError(`${provider} is not a known free provider.`);
  const seen = new Set<string>();
  return out.filter((m) => m.id && !NOT_CHAT.test(m.id) && !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.id.localeCompare(b.id));
}
