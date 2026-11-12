# Development Status

_Last updated: 2026-11-12, session 1_

## Done and verified
| Item | Evidence |
|---|---|
| Monorepo (pnpm 10 + Turborepo), shared tsconfig | `pnpm install` clean |
| Prisma 7 schema: all 25 core models | `prisma generate` OK; migration applied to Postgres 16 |
| RLS migration | SQL test as `authenticated` role: tenant isolation holds, secrets tables deny all |
| NestJS 12 API: config validation, health, helmet, CORS | Server started; `/health` → ok, `/projects` → 401 without token |
| Supabase JWT auth (JWKS + legacy HS256), user + personal org provisioning, suspended-account block | e2e tests |
| Org role checks (viewer/member/admin/owner), 404-not-403 tenancy | e2e tests |
| Projects CRUD + cursor pagination + soft delete + transactional audit log | e2e tests |
| **API test suite: 9/9 passing** (`pnpm --filter @mya/api test`, real Postgres) | run 2026-11-12 |

## Not started yet. Next session, in order:
1. Design tokens + `ui-web` / `ui-native` primitives
2. Next.js web shell (Supabase login, Home, Create, Projects, Settings)
3. Expo mobile shell (Supabase login, tab navigation, Home, Create, Projects)
4. `packages/ai`: provider interface + Anthropic adapter + router (retries, fallback, budget)
5. Agent contracts + orchestrator; Architect agent first
6. Sandbox adapter (Docker) + per-project git storage
7. End-to-end: prompt → spec → Next.js template files → typecheck/build in sandbox → commit → version
8. Credit ledger debits for AI usage

## Requires customer configuration
- Supabase project: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `DIRECT_URL`, plus `SUPABASE_JWT_SECRET` if the project uses legacy keys
- `ANTHROPIC_API_KEY`
- Not connected yet: Redis, Inngest, R2, Sentry, Stripe/Razorpay, EAS, Vercel/Cloudflare

## Known environment notes
- In the build sandbox, Prisma's native schema-engine download (`binaries.prisma.sh`) is blocked. The init migration SQL was produced with Prisma's official wasm schema engine instead. On a normal machine, `prisma migrate dev` works as usual.
