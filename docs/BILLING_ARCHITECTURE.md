# Billing Architecture

## Principles
1. **Only verified server-side provider events change entitlements or add purchased credits.** A checkout redirect or client callback changes nothing. The UI polls `/billing/checkouts/:id` until a webhook completes it.
2. **The ledger is append-only and server-written.** No customer endpoint writes `CreditLedgerEntry` or `SubscriptionEntitlement`. All money and credit changes run in DB transactions, serialised per org with advisory locks and protected by unique idempotency keys.
3. **Plans are data.** Plans, prices, packs and limits live in the database and are edited in the Owner console. Prices are immutable once created, so to change a price you create a new plan version.

## Data model
`Plan` (spec: SubscriptionPlan) → `PlanPrice` (interval × currency, with provider plan/price ids) → `Subscription` (one per org) → `Invoice`. `SubscriptionEntitlement` is the effective limits snapshot per org. `BillingCheckout` records every checkout we start. `CreditPack` is top-up products. `CreditLedgerEntry` has two **buckets**: `allowance` (monthly, expires) and `purchased` (top-ups, never expire). Spending draws on the allowance first.

## Providers
Platform accounts are configured through env, separate from merchant store gateways.

| | Razorpay (INR) | Stripe (other currencies) |
|---|---|---|
| Plan setup | Created automatically via `POST /v1/plans` on first checkout | Owner creates a recurring Price in Stripe and saves `stripePriceId` |
| Subscribe | `POST /v1/subscriptions` → Razorpay Checkout with `subscription_id` | Checkout Session `mode=subscription` → hosted page |
| Top-up | `POST /v1/orders` → Razorpay Checkout | Checkout Session `mode=payment` |
| Activate / renew | `subscription.activated`, `subscription.charged` | `checkout.session.completed` (links the subscription), then `invoice.paid` |
| Payment issues | `subscription.pending` → past_due; `subscription.halted` → Free | `invoice.payment_failed` → past_due |
| End | `subscription.cancelled` / `completed` | `customer.subscription.deleted` |
| Cancel | `POST /v1/subscriptions/:id/cancel {cancel_at_cycle_end}` | `subscriptions.update(cancel_at_period_end)` |
| Signature | `X-Razorpay-Signature` HMAC-SHA256 over the raw body | `Stripe-Signature` via the SDK's `constructEvent` |

Webhook endpoints: `POST /api/v1/webhooks/billing/{razorpay|stripe}`. Each event id is processed once (`PaymentWebhookEvent`). The amount and currency must cover the price or pack, otherwise the event is rejected and logged as `amount_mismatch`.

## Lifecycle
| Event | Effect |
|---|---|
| New workspace | Free entitlement plus Free allowance for the calendar month. Free renews lazily on the first request after month end |
| Paid charge (first or renewal) | Subscription active, period set, invoice created, **unused allowance expired and a new allowance granted** (idempotent per period) |
| Payment failed | `past_due`, with entitlements kept during the provider's retry window |
| Halted or ended | Reverts to the Free entitlement and allowance. **Projects are never deleted.** If active projects exceed the Free limit, AI generation is blocked (HTTP 402, `plan_limit_projects`) until the customer archives projects or upgrades. Viewing and exporting still work |
| Cancel | Provider set to cancel at period end; the plan stays active until the provider's end event |
| Upgrade or downgrade | New checkout. When the new subscription's charge is verified, the old provider subscription is cancelled immediately. **No proration yet** |

## Known gaps
- No proration.
- Invoice numbers come from one global sequence. GST may require consecutive numbering per financial year and an invoice PDF with GSTIN, which is not built.
- Refunds of platform invoices are not exposed in the console yet (`Invoice.refundedMinor` exists).
- Dunning emails are not built.
- Hosting, build and storage add-ons are not built.
- Not yet run against live Razorpay or Stripe accounts. All tests use the real request builders and signature checks against emulated APIs.
