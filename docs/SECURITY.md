# Security

## Identity & access
- Supabase Auth JWTs are verified on every request. Asymmetric JWT signing keys are verified via JWKS; legacy projects use the HS256 secret.
- Authorization is enforced in services through `assertOrgRole(userId, orgId, minRole)`. Roles: `owner > admin > member > viewer`.
- Postgres Row Level Security is enabled on all tenant tables (`packages/db/sql/rls.sql`) as defence in depth. The API connects with a role that bypasses RLS only through Prisma's server connection. Direct client access via the Supabase anon key sees only the rows that the policies allow.
- Admin APIs live under `/admin/*` behind `PlatformAdminGuard`, which checks `User.platformRole`. Hidden UI is never treated as access control.

## Secrets
- Secrets are read only from environment variables, which are validated at boot with zod. They are never logged, because pino redacts auth headers and keys.
- Customer integration credentials are stored encrypted (AES-256-GCM, key from `ENCRYPTION_KEY`). Database rows hold references, not plaintext.
- Never exposed to clients: AI keys, payment secrets, Supabase service-role key, signing keys, sandbox credentials.

## Generated code execution
- Generated code never runs in the API process. Sandboxes run with CPU, memory and PID limits, a read-only root filesystem except the workspace, no host mounts, egress restricted to package registries during install and none during test, wall-clock timeouts, and cleanup on exit.

## Web
- Request validation with zod on every body and query. Helmet. CORS allow-list. Rate limits per IP and per user (Redis).
- Webhook endpoints verify provider signatures over the raw body before parsing. Duplicate events are dropped using idempotency keys.

## Payments
- Raw card data is never touched. Card capture uses provider-hosted checkout or SDKs with tokenization only.

## Audit
- `AuditLog` row for: auth events, project create/delete, approvals, publishing, domain changes, billing changes, admin actions.
