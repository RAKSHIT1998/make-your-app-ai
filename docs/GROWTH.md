# Growth Engine (spec: "Viral AI Software-Building Ecosystem")

_Status as of 2026-11-13. Source spec ended mid-way through §3F; later sections not yet received._

## Implemented (phase G1)

### Public showcase
- **Publishing** (`PUT /projects/:id/publishing`, member role): private ↔ public, title, description, category, *Allow remix*, *Show "Made with Make Your App AI"*.
  - Publishing freezes the current head version (`publishedVersionId`) and a **snapshot** (pages, palette, file count, summary). Later private edits are never exposed until the owner republishes; the UI shows "outdated".
  - Requires a generated version; archived or moderated projects can't be published. Archiving or deleting a project unpublishes it.
  - Free plans must keep the attribution badge (402 otherwise). Enforced server-side.
  - First publish gives the creator a handle (`/c/:handle`), editable in Settings (validated, unique, reserved words blocked).
- **Explore** (`GET /explore`, public): search (title, description, @handle), type and category filters, sorts: trending (7-day likes×3 + remixes×5 + unique daily views + small recency boost), new, most liked, featured. Paged.
- **Project pages** `/p/:slug` (public, server-rendered metadata + Open Graph image generated from the real title, creator and design palette), creator profiles `/c/:handle`.
- **Likes** (signed in, once per user) and **views** (once per viewer per day; anonymous viewers keyed by a hash of IP + user agent; owners' visits don't count).
- **Share**: copy link, WhatsApp, LinkedIn, X; Instagram via the native share sheet or copy (Instagram has no web share URL).
- **No fake previews**: pages show an abstract preview drawn from the project's real design palette, clearly labelled, with "Live preview · soon".

### Remix with AI
`POST /showcase/:slug/remix` creates a **new project in the caller's workspace** from the **published version only**, preserving the original, recording lineage (`remixedFromId`), incrementing the original's remix count, and committing "Remixed from … by @creator" as version 1. Plan limits (active projects, project types) apply. Secret-like files (`.env*`, keys, `.pem`, `.npmrc`, `secrets.*`) are never copied. Further AI requests on the remix are incremental edits. The creator can turn remixing off.

### Referral programme
- Every user gets a code; link `/r/:code` → sign-up → code claimed once after sign-in.
- **Claim rules**: programme on; valid active referrer; not your own code; not someone you invited; within the claim window after sign-up (default 7 days); before your first payment; one referrer per account.
- **Rewards only after the referred user's first verified payment** (subscription or top-up webhook, signature-verified). Both sides get never-expiring credits through the ledger with idempotency keys (`referral:{id}:referrer|referred`), so fake sign-ups earn nothing and webhook retries can't double-pay.
- **Limits**: max rewarded referrals per referrer per month (default 10); inactive referrers aren't rewarded. Rejections are recorded with a reason.
- Owner console → Growth: reward amounts, monthly cap, claim window, on/off, and recent referrals.

### Safety and moderation
- Reports (one per user per project, not on your own project). **Three distinct open reports auto-hide** the project pending review.
- Owner console → Growth: open reports, hide (with a note shown to the creator; blocks republishing), restore, dismiss, feature/unfeature. Everything is audited.
- Public payloads never include emails or private data; rate limits on views, likes, remix, report and claim.

## Next (phase G2 — community)
Weekly challenges with submissions, community voting and leaderboards; comments with moderation and spam limits; follows; collections; achievement badges; notification of new likes/remixes.

## Next (phase G3 — AI building experience, §3)
| Feature | Status / dependency |
|---|---|
| Plan-first conversational builder (clarifying questions, plan approval) | Buildable now on the existing orchestrator |
| Voice input (speech-to-text in browser, confirmation before expensive actions) | Buildable now (Web Speech API, progressive) |
| Backend, database, auth and integration generation | Needs backend agent + sandbox runtime |
| Run, test workflows, working preview | Needs sandbox/hosting (Docker host) |
| Screenshot-to-app | Needs file storage (R2) + vision model (Anthropic key) |
| Visual editor, design variations with previews | Needs live preview |
| Durable orchestration (retries, cancellation, timeouts, cost limits) | Per-run cost caps and retries exist; durable queue needs Inngest + Redis |
