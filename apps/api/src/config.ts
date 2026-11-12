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
    /** Monthly credit allowance of the default Free plan when plans are first seeded. */
    /** Requests per minute per client (IP + user). In-memory store; switch to Redis storage when running >1 instance. */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
    /** 32-byte key (base64) for encrypting customer integration credentials at rest. Required to connect payment gateways. */
    ENCRYPTION_KEY: z.string().optional().refine((v) => !v || Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
    /** Public base URL of this API, used to show merchants their webhook URL. */
    PUBLIC_API_URL: z.string().default('http://localhost:4000'),
    /** Minutes a checkout holds stock while awaiting payment. */
    CHECKOUT_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
    CHECKOUT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(15),
    GENERATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
    /** Comma-separated emails that are promoted to platform superadmin on sign-in (owner bootstrap). */
    PLATFORM_OWNER_EMAILS: z.string().default(''),
    /** The platform's OWN payment accounts (customers paying Make Your App AI). */
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    /** Hosting: "vercel" needs VERCEL_TOKEN (platform account). "fake" is for local dev/tests only. */
    HOSTING_PROVIDER: z.enum(['vercel', 'fake', 'none']).default('none'),
    VERCEL_TOKEN: z.string().optional(),
    VERCEL_TEAM_ID: z.string().optional(),
    MAX_DEPLOYMENTS_PER_DAY: z.coerce.number().int().positive().default(30),
    DEPLOY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    /** Where customers return after checkout. */
    WEB_APP_URL: z.string().default('http://localhost:3000'),
    /** Optional USD→INR rate used ONLY for margin reports (AI costs are billed to us in USD). */
    REPORTING_USD_INR: z.coerce.number().positive().optional(),
    FREE_PLAN_CREDITS: z.coerce.number().int().nonnegative().default(100),
    /** Reverse-proxy hops in front of the API (load balancer = 1) so rate limits and audit logs see the real client IP. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /** On boot, fail runs left "running" by a previous process. Single-instance deployments only (until the durable queue). */
    RECOVER_INTERRUPTED_RUNS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    /** Seconds to wait for in-flight AI runs on shutdown before exiting (unfinished runs are recovered on next boot). */
    SHUTDOWN_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(25),
  })
  .superRefine((e, ctx) => {
    // Report every problem at once (keys only — never values).
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const prod = e.NODE_ENV === 'production';
    if (!e.SUPABASE_URL && !e.SUPABASE_JWT_SECRET) bad('SUPABASE_URL', 'Set SUPABASE_URL (JWKS verification) and/or SUPABASE_JWT_SECRET (legacy HS256).');
    if (e.HOSTING_PROVIDER === 'vercel' && !e.VERCEL_TOKEN) bad('VERCEL_TOKEN', 'HOSTING_PROVIDER=vercel needs VERCEL_TOKEN.');
    if (prod && e.HOSTING_PROVIDER === 'fake') bad('HOSTING_PROVIDER', 'HOSTING_PROVIDER=fake is for development only.');
    if (prod && e.SANDBOX_PROVIDER === 'local') bad('SANDBOX_PROVIDER', 'SANDBOX_PROVIDER=local is development-only; use docker (or a managed sandbox) in production.');
    if (prod && !e.ENCRYPTION_KEY) bad('ENCRYPTION_KEY', 'ENCRYPTION_KEY is required in production (openssl rand -base64 32).');
    if (prod) {
      for (const k of ['WEB_ORIGIN', 'WEB_APP_URL', 'PUBLIC_API_URL'] as const) {
        if (!e[k].split(',').every((x) => x.startsWith('https://') && !/localhost|127\.0\.0\.1/.test(x))) bad(k, `${k} must be a public https:// URL in production.`);
      }
      if (!e.STORAGE_DIR.startsWith('/')) bad('STORAGE_DIR', 'STORAGE_DIR must be an absolute path on a persistent disk in production.');
    }
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
