# Business Model

Make Your App AI sells subscriptions. Each subscription gives a monthly AI-credit allowance plus platform capabilities. Revenue sources: monthly and annual plans, credit top-ups, and (planned) hosting, build credits, premium templates, storage, domains, team seats and enterprise.

## Plans (initial proposals, all editable in the Owner console with no code changes)
| Plan | Price (incl. tax) | AI credits / month | Active projects | Daily credit limit | Max credits / run | Seats |
|---|---|---|---|---|---|---|
| Free | ₹0 | 100 | 1 | 60 | 80 | 1 |
| Creator | ₹999/mo · ₹9,990/yr | 480 | 3 | 200 | 150 | 1 |
| Pro | ₹2,499/mo · ₹24,990/yr | 1,200 | 10 | 400 | 300 | 1 |
| Studio | ₹7,999/mo · ₹79,990/yr | 3,800 | 40 | 1,200 | 500 | 5 |

Credit packs: 300 credits for ₹499, 1,000 credits for ₹1,499, 300 credits for $6.

The monthly prices are the founder's proposals. **Yearly prices, credit allowances, daily limits and pack prices are proposals made in this codebase** and need the founder's sign-off.

## How credits map to cost
- `CREDITS_PER_USD = 100`, so **1 credit = $0.01 of model cost** at list price. Every AI call writes an `AiUsage` row (tokens, USD-micro cost) and debits `ceil(cost × 100)` credits.
- Allowances are sized so that **if a customer uses 100% of their allowance, AI cost is about 40% of the plan price** (₹/$ ≈ 85 assumed when sizing):

| Plan | Price | Max AI cost if fully used | Share of price |
|---|---|---|---|
| Creator | ₹999 (~$11.75) | 480 credits = $4.80 | ~41% |
| Pro | ₹2,499 (~$29.40) | $12.00 | ~41% |
| Studio | ₹7,999 (~$94.10) | $38.00 | ~40% |

  Most subscribers use well under 100%, so typical gross margin will be higher. Payment fees (~2% on Razorpay), GST, and the sandbox, hosting and storage costs (not yet metered) come out of the remainder.
- Credit packs are priced at about a 2× markup over AI cost (300 credits = $3 cost for ₹499 ≈ $5.87).
- A website generation run costs about 20–40 credits on Sonnet-class models, depending on size. That gives Creator roughly 12–24 generations or edits a month. **Validate this with real runs before launch** and adjust allowances in the Owner console.

## Fair use & abuse controls (implemented)
Per-plan active-project limit, generatable project types, daily credit limit, per-run credit cap, global/route rate limits, admin suspension and credit clawback. Unlimited AI usage is never offered.

## Unit-economics reporting (implemented)
The Owner console shows MRR/ARR by currency, 30-day revenue (gross, refunds, provider fees), AI cost in USD, gross margin in INR (requires `REPORTING_USD_INR`), and per-customer net revenue vs AI cost.

**Not yet metered:** sandbox compute, storage, hosting bandwidth and build minutes. Margin reports state this.

## Recommendation before launch
The Pro and Studio features beyond website generation (mobile builds, full-stack, hosting, teams) are **not built yet**. The pricing page marks them "coming soon". Until they ship, consider hiding Pro and Studio in the Owner console, or selling them only as higher credit tiers.
