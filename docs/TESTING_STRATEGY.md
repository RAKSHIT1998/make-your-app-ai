# Testing Strategy

Rule: a capability is marked done only after its tests have **run and passed**. Results are recorded in DEVELOPMENT_STATUS.md.

## Layers
| Layer | Tooling | What it covers | Command |
|---|---|---|---|
| Unit | Vitest | Router retries/fallback/budget, JSON schema conversion, patch safety, import validator, git store | `pnpm test` |
| Adapter contract | Vitest + injected `fetch` | Real Anthropic SDK request/response path and error mapping, without network | `pnpm --filter @mya/ai test` |
| Agent orchestration | Vitest + `ScriptedProvider` | Agent order, schema retry, QA repair loop, approvals, prompt-injection wrapping | `pnpm --filter @mya/agents test` |
| Sandbox integration | Vitest, `SANDBOX_INTEGRATION=1` | Real `npm install` + `tsc` + `next build` of the template and of AI-produced code | `pnpm test:integration` |
| API e2e | Vitest + Supertest + **real Postgres** | Auth (forged/expired tokens), tenant isolation (404 not 403), roles, generation runs, credits, approvals, SSE, rate limits, error shape, commerce checkout/webhooks/refunds | `pnpm --filter @mya/api test` |
| Database | SQL as `authenticated` role | RLS isolation | see DATABASE_SCHEMA.md |
| Web components | Vitest + Testing Library (jsdom) | Type picker, badges, API client auth/errors | `pnpm --filter @mya/web test` |
| Browser journeys | Playwright + Chrome, desktop 1440px and mobile 390px | Sign in → create → generate → edit → files → versions → dark mode, failing on any console error | harness (see below) |
| Mobile | `tsc` + `expo export` for iOS/Android + Playwright on the react-native-web build | Type safety, Metro bundling, full flow | `pnpm typecheck:mobile` |

## Fakes, and where they are allowed
- `ScriptedProvider` (AI) and fake payment providers are **test doubles only**. They are injected via DI overrides in tests and never registered by production config.
- Browser journeys use a local auth stub that signs HS256 tokens exactly as Supabase legacy projects do. The API verification path under test is the real one.

## Next
- Run Playwright journeys in CI against ephemeral Postgres.
- React Native Testing Library for screen-level mobile tests.
- Load tests (k6) for generation start and storefront checkout in Phase 7.
- A live-provider smoke test (opt-in, needs `ANTHROPIC_API_KEY`).
