# Agent Contracts

Every agent is a function `(input: In, ctx: AgentContext) => Promise<Out>`. `In` and `Out` are zod schemas in `packages/agents/src/contracts`. The orchestrator:

- asks the model for JSON that matches `Out`, using native structured output when the provider supports it and otherwise a JSON-only instruction plus extraction;
- validates the result with `Out.safeParse`. On failure it retries with the validation errors attached, up to `maxAttempts` (default 2), and then fails the task;
- records an `AgentTask` row for the call and an `AgentEvent` row for every state change;
- gives each agent only the tools it needs (see the table below).

## Shared types

```ts
FilePatch = { op: 'create' | 'update' | 'delete', path: string, content?: string, reason: string }
```
Paths must be relative, normalised and inside the project root. No `..`, no absolute paths and no `.git/`. `update` replaces the whole file content; diff mode comes later.

## Agents

| # | Agent | Input | Output | Tools |
|---|---|---|---|---|
| 1 | Product Architect | user prompt, project type, existing spec? | `ProductSpec` { name, category, summary, screens[], entities[], integrations[], tasks[], securityNotes[] } | none |
| 2 | UI/UX Designer | ProductSpec | `DesignSpec` { palette, typography, components[], screens[] } | none |
| 3 | Frontend Dev | ProductSpec, DesignSpec, file index, task | `{ patches: FilePatch[], notes }` | read files |
| 4 | Backend Dev | ProductSpec, file index, task | `{ patches: FilePatch[], notes }` | read files |
| 5 | QA & Debug | failing check logs, file index, relevant files | `{ diagnosis, patches: FilePatch[] }` | read files, run checks (via sandbox) |
| 6 | Release | project config, target | `{ envTemplate, checklist[], configPatches: FilePatch[] }` | read files |

## Guardrails
- Content from the customer's project files and prompts is placed in clearly delimited data blocks, never in instruction position (prompt-injection mitigation).
- Agents cannot publish, deploy, change domains, activate payments or delete projects. Those actions require an `ApprovalRequest` that the customer approves.
- Any patch set that deletes files, or that rewrites more than 60% of an existing file, is flagged `destructive`. On edit runs a destructive patch set requires approval before it is applied.

## Per-task guarantees (implemented)
| Requirement | Where |
|---|---|
| Unique task ID | Each attempt is an `AgentTask` row (uuid) with an `attempt` number |
| Input / output schema | zod schemas in `packages/agents/src/contracts.ts`, sent to the model as JSON Schema (structured output) and re-validated on receipt |
| Tool permissions | Agents have **no tools and no shell**. They return data only (specs or file patches). Only the orchestrator applies patches (through `safePath`) and runs allow-listed commands in the sandbox |
| Execution status | `AgentTask.status`: running → succeeded / failed, timestamps included |
| Retry limit | Schema failures: 2 attempts per agent call. Provider errors: 3 attempts per route, then fallback. QA repair: 2 loops |
| Error handling | Invalid output → `AgentOutputError`. Budget → `BudgetExceededError`. Both fail the run visibly with a message |
| Usage tracking | One `AiUsage` row per model call (tokens, cost in micros, credits, latency, success), plus a ledger debit |
| Audit history | `AgentEvent` stream per run, plus `AuditLog` for starts, approvals and restores |

Agents not yet implemented: **backend** (with full-stack templates, Phase 3) and **release** (Phase 5). Their contracts are defined above but not wired in.
