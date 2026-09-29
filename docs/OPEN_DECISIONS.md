# Open business decisions (owner's call)

None of these have been guessed. Code that depends on them is either off or uses an obvious placeholder.

| # | Decision | Why it matters | Where it plugs in |
|---|---|---|---|
| 1 | ~~App name and branding~~ **Decided: BulkFlow**, logo provided. Listing tagline still open. | | `shopify.app.toml`, `public/brand/` |
| 2 | **Pricing: plan prices, allowances, credit packs** | **Proposed, awaiting approval**: see `docs/PRICING_PROPOSAL.md`. Billing is built but off (`BILLING_ENABLED`) and in test mode until `BILLING_TEST=false`. | `app/lib/billing/plans.ts` |
| 3 | **Public distribution** (required for the Billing API) | Shopify refuses all Billing API calls, even test charges, from apps without public distribution. Choosing a distribution method can't be undone. | Partner Dashboard → BulkFlow → Distribution |
| 4 | **Free trial length** | Proposed: 7 days on paid plans, plus the Free plan. | `TRIAL_DAYS` in `app/lib/billing/plans.ts` |
| 5 | ~~Plan limits~~ **Built**: per-shop usage per 30-day period, enforced when billing is on; jobs pause and resume instead of failing. Allowances are part of #2. | | `app/lib/billing/usage.server.ts` |
| 6 | **AI model and cost ceiling** | Code defaults to Claude Opus 5 (`AI_MODEL`). A cheaper model lowers per-item cost and may change quality; measure on a real catalog before choosing, since this sets the margin on every plan. | `AI_MODEL` env var |
| 7 | **Write directly vs review first** | v1 writes directly (the only-missing default is safe, and before-values are kept for undo). Some merchants will want approve-before-publish. | Stage 2 item |
| 8 | **Operator legal entity, support email, privacy contact** | Required in the privacy policy and App Store listing. | `app/routes/privacy.tsx` placeholders |
| 9 | **Hosting provider and region** | Affects data-residency answers in the listing and the privacy policy. | Deployment |
| 10 | **Default languages supported** | Prompts write in the product's language; the listing should say which languages were tested. | Listing |
