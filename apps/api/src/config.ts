import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().min(1),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_JWT_SECRET: z.string().min(16).optional(),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    ANTHROPIC_API_KEY: z.string().optional(),
    /** Persistent directory holding one git repository per project. */
    STORAGE_DIR: z.string().default('./.data/projects'),
    SANDBOX_PROVIDER: z.enum(['local', 'docker', 'none']).default('local'),
    SANDBOX_DOCKER_IMAGE: z.string().default('node:22-bookworm-slim'),
    SANDBOX_DOCKER_INSTALL_NETWORK: z.string().default('mya-registry-egress'),
    /** Credits charged per USD of model cost (100 → 1 credit = $0.01 of AI spend). */
    CREDITS_PER_USD: z.coerce.number().positive().default(100),
    /** Hard cap on credits one generation run may consume. */
    MAX_CREDITS_PER_RUN: z.coerce.number().int().positive().default(500),
    /** One-time credit grant for new workspaces (until billing plans are configured). */
    FREE_PLAN_CREDITS: z.coerce.number().int().nonnegative().default(200),
  })
  .refine((e) => e.SUPABASE_URL || e.SUPABASE_JWT_SECRET, {
    message: 'Set SUPABASE_URL (JWKS verification) and/or SUPABASE_JWT_SECRET (legacy HS256).',
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.SANDBOX_PROVIDER === 'local'), {
    message: 'SANDBOX_PROVIDER=local is development-only; use docker (or a managed sandbox) in production.',
  });

export type AppConfig = z.infer<typeof EnvSchema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Never print values — only which keys are wrong.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${issues.join('\n  ')}`);
  }
  return parsed.data;
}
