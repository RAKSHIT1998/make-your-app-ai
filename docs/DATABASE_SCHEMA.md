# Database Schema

Source of truth: `packages/db/prisma/schema.prisma`. Migrations: `packages/db/prisma/migrations/`.

| Migration | Contents |
|---|---|
| `20261112000000_init` | All core tables, enums, indexes, FKs |
| `20261112100000_commerce` | Store, Product, Collection, ProductCollection, ProductVariant, Inventory, Customer, Order, OrderItem, Payment, Refund, Discount, ShippingConfiguration, PaymentWebhookEvent, plus RLS and CHECK constraints (stock never negative, reserved ≤ on-hand, refunded ≤ total) |
| `20261112200000_billing` | PlanPrice, SubscriptionEntitlement, BillingCheckout, CreditPack, Invoice; credit buckets; subscription statuses halted/expired; `invoice_number_seq`; RLS and CHECK constraints |
| `20261112000100_rls` | RLS enabled on all 25 tables, read policies, helper functions `mya_uid()`, `mya_is_member()`, `mya_can_see_project()` |

## Domains
- **Identity & tenancy:** `User` (id = Supabase `auth.users.id`), `Organization`, `OrganizationMembership` (owner/admin/member/viewer)
- **Billing:** `Plan` (= SubscriptionPlan) → `PlanPrice` → `Subscription` → `Invoice`; `SubscriptionEntitlement` (effective limits, written only by verified billing events); `BillingCheckout`; `CreditPack`; `CreditLedgerEntry` (append-only, idempotency key, buckets `allowance`/`purchased`). See BILLING_ARCHITECTURE.md
- **Naming vs spec v3:** SubscriptionPlan → `Plan`. Commerce payments → `Payment`. Platform payments → `Invoice` (one per verified payment). SupportTicket → `SupportRequest`. Deployment → `HostingDeployment`. CreditLedger → `CreditLedgerEntry`. AIProvider → `AiProviderConfig`
- **Projects:** `Project`, `ProjectFile` (head index + small-file cache), `ProjectVersion` (→ git commit SHA)
- **AI engine:** `GenerationRun`, `AgentTask`, `AgentEvent`, `AiProviderConfig`, `AiUsage` (cost in USD micros, kept separate from credits charged)
- **Builds & release:** `BuildJob`, `BuildArtifact`, `HostingDeployment` (status `live` only after a passing health check), `Domain`, `PublishingRecord`, `DeveloperAccount`
- **Integrations:** `Integration` (encrypted credentials, never plaintext)
- **Commerce:** multi-tenant by `storeId` → `organizationId`. Money is integer minor units. `Inventory.available = onHand − reserved`. `Order.checkoutToken` (idempotency) and `Order.accessToken` (buyer access) are unique. `PaymentWebhookEvent(provider, eventId)` is unique, which gives exactly-once webhook processing
- **Safety & ops:** `ApprovalRequest` (publish / domain / payment / destructive / paid upgrade), `AuditLog`, `Notification`, `SupportRequest`

## Tenancy rules
1. Every tenant row is reachable from `organizationId`, either directly or through `projectId`.
2. API services authorize through `OrgsService.assertRole()`. Resources outside the caller's org return 404, not 403, so IDs can't be probed.
3. RLS denies all access to `Integration`, `DeveloperAccount`, `AiProviderConfig` and `AuditLog` for directly connected clients. This was verified with an `authenticated`-role SQL test: user A saw only A's project, saw zero integrations, and anonymous access saw nothing.
4. Projects are soft-deleted (`deletedAt`). Git history is retained for recovery.

## Commands
```bash
pnpm db:generate     # prisma generate
pnpm db:migrate      # prisma migrate dev (local)
pnpm db:deploy       # prisma migrate deploy (CI / prod)
```
