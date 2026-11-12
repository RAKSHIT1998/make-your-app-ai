# Runbook

Operating Make Your App AI in production. Deploy steps live in `DEPLOYMENT.md`.

## Health
- `GET /api/v1/health/live`: the process is up (container HEALTHCHECK).
- `GET /api/v1/health`: readiness, including the database (Render health check). `{"db":"down"}` → check Supabase status, the `DATABASE_URL` pooler and connection limits.
- Logs go to stdout. Every error response carries an `x-request-id` (also in the JSON body), so search the logs by it. Privileged, billing and moderation actions are also written to Admin → Audit log.

## Restarts and deploys
- On SIGTERM the API stops accepting work and waits up to `SHUTDOWN_GRACE_SECONDS` (default 25) for in-flight generation runs to finish. Runs still unfinished are failed immediately with "Interrupted by a server restart", so users aren't left waiting.
- Each running generation holds a **lease**: its instance renews a heartbeat every few seconds. With `RECOVER_INTERRUPTED_RUNS=true`, any instance fails runs whose lease lapsed (`RUN_LEASE_SECONDS`, default 60), for example after a crash or kill -9, and unsticks the project. Live runs on other instances are never touched. Credits are charged per AI call actually made, so users pay only for work already done and can retry.
- Migrations run before the new version starts (Render `preDeployCommand`). Migrations are additive. If one fails, the deploy stops and the old version keeps serving.

## Rollback
1. Render → mya-api → Deploys → pick the last good deploy → **Rollback**. Do the same for mya-web.
2. Database: migrations are forward-only. A rollback of code is safe while the newer schema is a superset (the case for every migration so far). Never hand-edit `_prisma_migrations`.
3. Project content is versioned in git under `STORAGE_DIR`. Users restore their own versions from the workspace; no operator action is needed.

## Backups
- **Database:** Supabase daily backups (point-in-time recovery on paid plans). Test a restore into a scratch project once before launch.
- **Project repositories:** Render snapshots persistent disks daily (check your plan's retention). For off-site copies, run `tar czf` of `/data/projects` to object storage on a schedule.
- **ENCRYPTION_KEY:** store it in a password manager or secrets vault separate from Render. Without it, stored merchant gateway keys and project env vars cannot be decrypted. Restoring a DB backup also needs the same key.

## Key rotation
| Secret | How |
|---|---|
| Anthropic, Vercel, Razorpay/Stripe platform keys | Create the new key at the provider, update it in Render, redeploy, then revoke the old one |
| Webhook secrets | Add the new secret at the provider, update the env, redeploy. Events signed with the old secret fail verification and are retried by the provider |
| Supabase JWT secret | Rotating it signs every user out. Prefer JWKS (asymmetric keys) where available |
| `ENCRYPTION_KEY` | Not rotatable in place today: re-encryption needs a migration script. Treat it as long-lived and protect it |

## Incidents
1. **Confirm:** check the health endpoints, the Render metrics and the error rate in the logs.
2. **Contain:** Admin → Platform → Flags turns off a failing area in seconds (`ai_generation`, `publishing`, `hosting`, `explore`, `remix`, `referrals`, `templates`, `voice_input`, `plan_first_builder`). Off means the API refuses those actions and the UI says why.
3. **AI provider outage:** turn off `ai_generation`. Failed runs charge only for AI calls that completed.
4. **Payment provider outage:** checkouts fail visibly. Entitlements change only through verified webhooks, and providers retry delivery, so nothing has to be granted by hand.
5. **Abuse / bad public content:** Admin → Growth → reports queue → hide the project (the creator sees your note). Admin → Customers → suspend an account (needs a reason; audited).
6. **Data exposure suspicion:** rotate the affected keys (above), review the audit log, and notify affected users and the grievance officer within the time the law requires.
7. Write a short postmortem: impact, timeline, root cause, fix, follow-ups.

## Scaling
Scale **up** first: a larger instance is simplest, and Anthropic rate limits usually bind before CPU does. The Render blueprint runs one instance because its persistent disk attaches to a single instance.

The API is safe to replicate when you provide the two shared pieces:
1. `RATE_LIMIT_STORE=postgres`, so request limits are enforced across all instances (otherwise each instance counts on its own).
2. A `STORAGE_DIR` that every instance can read and write (a network volume such as NFS/EFS). Projects are git repositories on that path, and the database already guarantees one active run per project.

Everything else is already instance-safe: run ownership uses leases, stock-hold release locks each order, webhooks are deduplicated in the database, and the flag cache refreshes every 5 seconds. Generation still executes in the instance that accepted the request (there is no separate queue); a crash is recovered by the lease sweep. Use a load balancer with no special affinity.

## Routine
- Weekly: Admin → Overview (revenue, AI cost, margin, failed generations) against the provider dashboards' payouts, plus the reports queue under Admin → Growth.
- Monthly: `pnpm audit --prod`, provider key review, and a restore test.
