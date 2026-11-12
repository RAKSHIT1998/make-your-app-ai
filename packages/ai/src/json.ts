import { z, type ZodType } from 'zod';

const UNSUPPORTED_KEYS = new Set(['$schema', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'format', 'default']);

/**
 * Converts a zod schema to a JSON Schema suitable for provider structured output:
 * objects are closed (additionalProperties:false) and value constraints are stripped
 * (the zod schema still enforces them after the response arrives).
 */
export function toProviderJsonSchema(schema: ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as Record<string, unknown>;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;
      out[k] = k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv)])) : walk(v);
    }
    if (out['type'] === 'object') out['additionalProperties'] = false;
    return out;
  };
  return walk(raw) as Record<string, unknown>;
}

/** Extracts the first JSON object/array from model text (handles ```json fences and leading prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fence?.[1]) return JSON.parse(fence[1]);
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new SyntaxError('No JSON found in model output');
}
