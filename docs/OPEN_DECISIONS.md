# Open business decisions (owner's call)

None of these have been guessed. Code that depends on them is either off or uses an obvious placeholder.

| # | Decision | Why it matters | Where it plugs in |
|---|---|---|---|
| 1 | **App name and branding** (name, icon, listing tagline) | Required for the Partner app, App Store listing, and billing plan names. `bulk-seo-app` is only a working codename. | `shopify.app.toml` `name`, landing page, listing |
| 2 | **Pricing: price, currency, billing interval** | Billing is wired but off until set. | `BILLING_PLAN_NAME`, `BILLING_PLAN_AMOUNT`, `BILLING_PLAN_CURRENCY` env vars (`app/billing.server.ts`) |
| 3 | **Billing Model: Billing API vs Shopify Managed Pricing** | Shopify can host the plan-selection page itself (Managed Pricing) instead of the app calling the Billing API. Code is currently Billing API. | `app/billing.server.ts`, `app/routes/app.tsx` |
| 4 | **Free trial length** (or none) | Shown on the approval screen. | `BILLING_TRIAL_DAYS` |
| 5 | **Plan limits**: images/products per month, or unlimited with a fair-use cap | Each alt text is a paid vision call; unlimited plans need a cost ceiling. | Not built yet: a per-shop monthly usage counter in the runner |
| 6 | **AI model and cost ceiling** | Code defaults to Claude Opus 5 (`AI_MODEL`). A cheaper model lowers per-item cost and may change quality; measure on a real catalog before choosing, since this sets the margin on every plan. | `AI_MODEL` env var |
| 7 | **Write directly vs review first** | v1 writes directly (the only-missing default is safe, and before-values are kept for undo). Some merchants will want approve-before-publish. | Stage 2 item |
| 8 | **Operator legal entity, support email, privacy contact** | Required in the privacy policy and App Store listing. | `app/routes/privacy.tsx` placeholders |
| 9 | **Hosting provider and region** | Affects data-residency answers in the listing and the privacy policy. | Deployment |
| 10 | **Default languages supported** | Prompts write in the product's language; the listing should say which languages were tested. | Listing |
