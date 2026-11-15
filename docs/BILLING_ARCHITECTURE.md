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

## Pay as you go (saved card)
Optional, per workspace (owner only). Saving a card unlocks **Premium AI** (balanced-tier steps use the deep tier, charged at the deep tier's rate; no deep route → unchanged), lifts the plan's daily limit and raises the per-run cap to `MAX_CREDITS_PER_RUN`. Usage past allowance and purchased credits is written to the `payg` ledger bucket (negative = owed) up to the customer's monthly cap, priced at the smallest active credit pack in that currency.

| | Razorpay (INR) | Stripe (USD) |
|---|---|---|
| Save card | `POST /customers`, then a ₹1 `POST /orders` with `method: card` and `token {max_amount = cap, frequency: as_presented}`; Checkout with `customer_id` and `recurring: 1` | `customers.create`, Checkout Session `mode=setup` |
| Activated by | `token.confirmed` (bank approved the mandate). `payment.captured` / `order.paid` for the ₹1 check only records the card label | `checkout.session.completed` (mode setup) → `setupIntents.retrieve` → payment method |
| Charge | New order, then `POST /payments/create/recurring` with the token. Bank pre-debit notice; debit ~36 h later | `paymentIntents.create {off_session, confirm}` with an idempotency key |
| Paid | `payment.captured` / `order.paid` for the charge's order | `payment_intent.succeeded` (metadata `kind=payg_charge`) |
| Failed | `payment.failed` | `payment_intent.payment_failed`, or an immediate decline from the API |

Charging runs every 15 minutes in the API (`PaygService.runBilling`): a workspace is charged when unpaid usage reaches `PAYG_CHARGE_AT_*`, or at the start of a month for usage from earlier months (at least `PAYG_MIN_CHARGE_*`). A partial unique index allows one unsettled charge per workspace across instances. A paid charge credits the `payg` bucket back, creates an invoice and clears `past_due`. A failed charge sets `past_due`: no new pay-as-you-go usage, Premium AI off, automatic retry after 72 h (3 times), and a **Pay now** button. Switching off stops new usage; what's owed is still charged. Failed-build refunds go back to the `payg` bucket, so they reduce what's charged.

## Known gaps
- No proration.
- Pay-as-you-go: tested against emulated Razorpay/Stripe APIs only. Razorpay's ₹1 card check is not invoiced or refunded by us (check the account's auto-refund setting), and the recurring-debit call sends no phone number (`contact`), which some Razorpay accounts require: verify with live test keys before launch.
- Invoice numbers come from one global sequence. GST may require consecutive numbering per financial year and an invoice PDF with GSTIN, which is not built.
- Refunds of platform invoices are not exposed in the console yet (`Invoice.refundedMinor` exists).
- Dunning emails are not built.
- Hosting, build and storage add-ons are not built.
- Not yet run against live Razorpay or Stripe accounts. All tests use the real request builders and signature checks against emulated APIs.
