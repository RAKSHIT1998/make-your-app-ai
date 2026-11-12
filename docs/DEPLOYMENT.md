# Deployment

## Local development
```bash
pnpm install
cp .env.example .env            # fill SUPABASE_*, DATABASE_URL, ANTHROPIC_API_KEY
docker compose -f infra/docker-compose.yml up -d   # redis (+ optional local postgres)
pnpm db:migrate                 # prisma migrate dev
pnpm dev                        # api :4000, web :3000
pnpm --filter @mya/mobile start  # Expo (press i / a for simulators)
SANDBOX_INTEGRATION=1 pnpm --filter @mya/agents test   # real npm install + tsc + next build of generated code
```

## Required configuration (customer must supply; nothing here is pre-connected)
| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | api, db | Supabase Postgres (pooled / direct) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | web, mobile, api | public |
| `SUPABASE_JWT_SECRET` | api | only for legacy HS256 projects |
| `ANTHROPIC_API_KEY` | api | first AI adapter |
| `REDIS_URL` | api | rate limiting, locks |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | api | prod only; dev uses Inngest dev server |
| `ENCRYPTION_KEY` | api | 32-byte base64 |
| `STORAGE_DIR` | api | Persistent directory holding one git repo per project (a mounted disk in prod) |
| `SANDBOX_PROVIDER` | api | `docker` in prod. `local` is dev-only and refused when NODE_ENV=production. `none` = static checks only |
| `SANDBOX_DOCKER_IMAGE`, `SANDBOX_DOCKER_INSTALL_NETWORK` | api | Image, plus an egress-filtered network that can reach package registries only |
| `CREDITS_PER_USD`, `MAX_CREDITS_PER_RUN`, `FREE_PLAN_CREDITS` | api | Credit pricing, per-run cap, starter grant |
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile | |
| `R2_*` | api | phase 3+ |

## Production (initial)
- Render: `api` web service, `web` web service (or Vercel), managed Redis. Supabase for Postgres and Auth. Inngest Cloud.
- `render.yaml` blueprint lives in `infra/` (added in Phase 1 completion).
- A deploy counts as succeeded only after `GET /health` returns `{db:"ok"}` from the deployed URL.
