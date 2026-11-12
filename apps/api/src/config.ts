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
  })
  .refine((e) => e.SUPABASE_URL || e.SUPABASE_JWT_SECRET, {
    message: 'Set SUPABASE_URL (JWKS verification) and/or SUPABASE_JWT_SECRET (legacy HS256).',
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
