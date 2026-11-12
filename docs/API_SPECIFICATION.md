# API Specification

Base URL: `API_URL/api/v1` (dev `http://localhost:4000/api/v1`). Every path below is relative to `/api/v1`. JSON only. Every route except those marked *public* requires `Authorization: Bearer <Supabase access token>`.

**Errors** are always `{ statusCode, error, message, details?, requestId }`. Send `x-request-id` to correlate requests; it is echoed back.
**Rate limits:** `RATE_LIMIT_PER_MINUTE` per client per route (default 300), checkout `CHECKOUT_RATE_LIMIT_PER_MINUTE` (15), generation start `GENERATION_RATE_LIMIT_PER_MINUTE` (20). Exceeding a limit returns 429.

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

### Commerce: merchant (authenticated; viewer reads, member edits catalog, admin for store, payments and refunds)
| Method | Path | Description |
|---|---|---|
| POST / GET | `/stores` | Create (admin of org) / list stores |
| GET / PATCH | `/stores/:id` | Store, payment status and webhook URL (never secrets) / update status, tax, theme |
| PUT | `/stores/:id/payments` | Connect Razorpay `{keyId,keySecret,webhookSecret}` or Stripe `{secretKey,publishableKey,webhookSecret}`. **Live connection test**, then encrypted at rest (AES-256-GCM). 503 `setupRequired` without `ENCRYPTION_KEY` |
| POST / GET | `/stores/:id/products` | Create with variants and inventory / list |
| PATCH / DELETE | `/stores/:id/products/:pid` | Update / archive (soft delete) |
| PATCH | `/stores/:id/variants/:vid` | Price, SKU, options |
| POST | `/stores/:id/variants/:vid/inventory` | `{set}` or `{adjust}`, row-locked. Cannot go below reserved stock |
| POST / GET / PATCH | `/stores/:id/discounts[/:did]` | Percentage (basis points), fixed amount or free shipping. Optional window, minimum and usage limit |
| POST / GET | `/stores/:id/shipping` | Flat rate with optional free-over threshold |
| GET | `/stores/:id/orders[?status=&cursor=]`, `/stores/:id/orders/:oid` | Orders with items, payments and refunds |
| POST | `/stores/:id/orders/:oid/fulfill` | Paid → fulfilled, with tracking number |
| POST | `/stores/:id/orders/:oid/refunds` | `{amountMinor, reason, restock, idempotencyKey}`. Over-refund safe, idempotent. Restock only on a full remaining refund |
| GET | `/stores/:id/analytics?days=` | Gross, refunds, net, orders, AOV, pending, top products, daily series, low stock (real orders only) |

### Commerce: storefront (public; used by generated stores)
| Method | Path | Description |
|---|---|---|
| GET | `/storefront/:slug` | Store info, theme, shipping options (active stores only) |
| GET | `/storefront/:slug/products[?q=&collection=]`, `/products/:handle` | Active catalog. Shows availability, never stock counts |
| POST | `/storefront/:slug/quote` | Server-side pricing (discount → shipping → tax) |
| POST | `/storefront/:slug/checkout` | `{checkoutToken, email, items, discountCode?, shippingId?, shippingAddress?}`. Locks stock, reserves it (`CHECKOUT_RESERVATION_MINUTES`) and opens a provider payment. Returns `accessToken` and public payment params. **Idempotent per checkoutToken.** 409 when out of stock |
| GET | `/storefront/:slug/orders/:oid?token=` | Buyer order view (requires the order's access token) |
| POST | `/storefront/:slug/orders/:oid/razorpay/confirm` | Razorpay Checkout callback. Verified with HMAC(order_id\|payment_id, key secret) |

### Payment webhooks (public, signature-verified over the raw body)
| POST | `/webhooks/payments/razorpay/:storeId` | `X-Razorpay-Signature`. Handles `payment.captured`, `order.paid` and `payment.failed` |
|---|---|---|
| POST | `/webhooks/payments/stripe/:storeId` | `Stripe-Signature` (SDK `constructEvent`). Handles `payment_intent.succeeded` and `payment_intent.payment_failed` |

Each event id is processed once. A payment marks its order paid only if the amount and currency match the order exactly.

## Planned (Phase 3–6). Not yet implemented.
| Method | Path | Notes |
|---|---|---|
| GET | `/projects/:id/preview` | Live preview URL from the sandbox preview server |
| * | `/builds`, `/deployments`, `/domains`, `/integrations`, `/billing/*` | Phases 4–6 |
| * | `/admin/*` | Separate `PlatformAdminGuard` |
| POST | `/webhooks/{stripe,razorpay,eas}` | Signature verified over the raw body |
