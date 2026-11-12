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

### Generation, files, versions, approvals, credits (tested)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/projects/:id/generations` | member+ | Body `{prompt}`. Returns 202 with a run. The first run creates the project and later runs edit it. 422 if the project type has no template yet, 402 if out of credits, 409 if a run is already active, 503 if no AI provider is configured |
| GET | `/projects/:id/generations` | viewer+ | Last 50 runs |
| GET | `/generations/:runId` | viewer+ | Run status, credits used, agent tasks |
| GET | `/generations/:runId/events?after=<id>` | viewer+ | Incremental AgentEvents (JSON polling) |
| GET | `/generations/:runId/stream` | viewer+ | Server-sent events, closed when the run finishes |
| GET | `/projects/:id/files` | viewer+ | File index at head |
| GET | `/projects/:id/file?path=` | viewer+ | File content |
| GET | `/projects/:id/versions` | viewer+ | Version history, marking which version is head |
| POST | `/projects/:id/versions/:versionId/restore` | member+ | Undo: commits the old tree as a new version |
| GET | `/projects/:id/approvals` | viewer+ | Approval requests (destructive edits) |
| POST | `/approvals/:id/approve` | admin+ | Applies the stored patches, verifies them and commits. Single use |
| POST | `/approvals/:id/reject` | member+ | Discards the change |
| GET | `/credits` | viewer+ | Org credit balance (sum of ledger entries) |

Run statuses: `queued → running → succeeded | failed | awaiting_approval`.

## Planned (Phase 3–6). Not yet implemented.
| Method | Path | Notes |
|---|---|---|
| GET | `/projects/:id/preview` | Live preview URL from the sandbox preview server |
| * | `/builds`, `/deployments`, `/domains`, `/integrations`, `/billing/*` | Phases 4–6 |
| * | `/admin/*` | Separate `PlatformAdminGuard` |
| POST | `/webhooks/{stripe,razorpay,eas}` | Signature verified over the raw body |
