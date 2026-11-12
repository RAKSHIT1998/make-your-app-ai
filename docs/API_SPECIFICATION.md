# API Specification

Base URL: `API_URL` (dev `http://localhost:4000`). JSON only. Every route except those marked *public* requires `Authorization: Bearer <Supabase access token>`.

Request bodies and queries are validated with the zod schemas in `@mya/shared`. A failed validation returns
`400 { message: "Validation failed", details: [{ path, message }] }`.

## Implemented (tested)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | `{status, db}`; 503 if the DB is unreachable |
| GET | `/me` | user | Current user, personal org, and org memberships with roles. Provisions the user and personal org on first call |
| POST | `/projects` | member+ | Body `CreateProjectSchema`. `organizationId` defaults to the personal org |
| GET | `/projects` | viewer+ | Query `organizationId?`, `limit` (1–100, default 20), `cursor?` → `{items, nextCursor}` |
| GET | `/projects/:id` | viewer+ | 404 if not visible |
| PATCH | `/projects/:id` | member+ | Body `UpdateProjectSchema` (name / description / status=archived) |
| DELETE | `/projects/:id` | admin+ | Soft delete → 204 |

## Planned (Phase 2–6). Not yet implemented.
| Method | Path | Notes |
|---|---|---|
| POST | `/projects/:id/generations` | Start a create or edit run (credit check) |
| GET | `/generations/:id` | Run status + tasks |
| GET | `/generations/:id/events` | SSE stream of AgentEvents |
| GET | `/projects/:id/files`, `/files/*path` | File tree / content at head |
| GET | `/projects/:id/versions` · POST `/versions/:vid/restore` | Version history, undo |
| POST | `/approvals/:id/approve` · `/reject` | Customer approvals |
| * | `/builds`, `/deployments`, `/domains`, `/integrations`, `/billing/*` | Phases 4–6 |
| * | `/admin/*` | Separate `PlatformAdminGuard` |
| POST | `/webhooks/{stripe,razorpay,eas}` | Signature verified over the raw body |
