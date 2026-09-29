# Pricing proposal (awaiting the app owner's approval)

Nothing here is live. Billing is off (`BILLING_ENABLED` unset) and, when switched on, stays in Shopify test mode until `BILLING_TEST=false`. The numbers live in one file, `app/lib/billing/plans.ts`; changing them is a one-line edit each.

## What a merchant pays for

One **item** = one successful, verified write: one image's alt text, or one product's meta title + description. Failed items, skipped items and anything left alone because it already had a value are free.

## Proposed plans

| Plan | Price / 30 days | Items included | Effective price per item |
|---|---|---|---|
| Free | $0 | 50 | – |
| Starter | $19 | 500 | 3.8¢ |
| Growth (highlighted) | $49 | 1,500 | 3.3¢ |
| Pro | $149 | 6,000 | 2.5¢ |

- 7-day free trial on paid plans (Free already lets merchants try without a card).
- Usage resets every 30 days per store. Upgrades take effect when the merchant approves in Shopify.

## Proposed credit packs (one-time charges, never expire)

| Pack | Price | Per item |
|---|---|---|
| 250 credits | $15 | 6.0¢ |
| 1,000 credits | $49 | 4.9¢ |
| 5,000 credits | $199 | 4.0¢ |

Credits cost more per item than any plan, so a merchant who keeps buying credits is better off upgrading. They're used only after the plan's included items, so a merchant is never hard-blocked: a job pauses and resumes by itself when credits are added.

## The cost behind it (estimates, not yet measured)

The main cost is the AI call per item. BulkFlow doesn't log token usage per call yet, so these are **estimates** from typical sizes: alt text ≈ 2,300 input tokens (one product photo + prompt) and ≈ 500 output tokens including the model's reasoning; meta ≈ 1,500 in / 500 out; plus ~10% for retries.

| Model (per 1M tokens in / out) | Alt text | Meta | Per item, with retries |
|---|---|---|---|
| Claude Opus 5 ($5 / $25), the current default | ~2.4¢ | ~2.0¢ | **~2.5¢** |
| Claude Opus 5.5 ($4 / $20) | ~1.9¢ | ~1.6¢ | ~2.0¢ |
| Claude Sonnet 5.5 ($2 / $10) | ~1.0¢ | ~0.8¢ | **~1.0¢** |
| Claude Haiku 4.5 ($1 / $5) | ~0.3¢ | ~0.3¢ | ~0.35¢ |

Gross margin if a merchant uses the whole allowance (the worst case for us):

| Plan | AI cost at ~2.5¢ (Opus 5) | Margin | AI cost at ~1.0¢ (Sonnet 5.5) | Margin |
|---|---|---|---|---|
| Free (50) | $1.25 | – | $0.50 | – |
| Starter $19 (500) | $12.50 | 34% | $5.00 | 74% |
| Growth $49 (1,500) | $37.50 | 23% | $15.00 | 69% |
| Pro $149 (6,000) | $150.00 | **−1%** | $60.00 | 60% |
| 250 credits $15 | $6.25 | 58% | $2.50 | 83% |
| 5,000 credits $199 | $125.00 | 37% | $50.00 | 75% |

Hosting (Vercel, Postgres) is small next to this. Shopify's revenue share on app charges also applies; check Shopify's current Partner terms for your account.

## My recommendation

1. **Prices are viable only with a Sonnet-class model**, or with Opus if prices roughly double. Before launch, run the same 50 real products through Claude Sonnet 5.5 and the current model and compare the alt text and meta side by side (`AI_MODEL` switches it). If Sonnet's quality holds, keep these prices; if not, raise Growth/Pro or shrink their allowances.
2. **Add per-call token logging first** (half a day), so these numbers become measured costs on a real catalog.
3. **Keep the Free plan at 50 items**: enough to see real results on one collection, cheap for us (~$0.50–$1.25 per store per month).

## What needs your decision

- The four plan prices and allowances, the three credit packs, and the 7-day trial.
- The AI model (see 1 above).
- **Public distribution in the Partner Dashboard.** Shopify refuses every Billing API call, including test charges, from apps without public distribution: this is what Shopify answered when I tried (“Apps without a public distribution cannot use the Billing API”). Choosing a distribution method in Shopify can't be undone, so this is your call.
