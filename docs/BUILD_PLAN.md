# Staged build plan

Working codename: **bulk-seo-app**. The public name is an open decision (see [OPEN_DECISIONS.md](OPEN_DECISIONS.md)).

The rule for every stage: nothing is marked done until it has been run against a real Shopify development store, with evidence (screenshots or logs of a real install, a real bulk run, real generated output).

## Stage 0: foundation (built in this pass)

| Area | Status |
|---|---|
| Shopify's official embedded-app template (React Router, App Bridge, Polaris web components, Prisma session storage) | Done |
| OAuth install flow, offline tokens (expiring + refresh), App Store distribution mode | From the template, unchanged |
| Multi-tenant data model: every row keyed by shop; no shared catalog, brand, category or collection assumptions | Done |
| Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) and `app/uninstalled` | Done; HMAC rejection checked locally (forged request → 401) |
| Billing API plumbing (plan gate on the embedded app) | Wired, **off** until pricing is decided |
| Public privacy policy page (`/privacy`) | Draft; operator details and legal review pending |
| Alt-text + meta generation, bulk job runner, progress UI | Built and unit/integration tested with fakes; **not yet run against a real store or the real AI API** |

## Stage 1: sellable v1 (the smallest thing worth charging for)

Scope:
1. **Bulk image alt text** for product images: fill missing (default) or rewrite all.
2. **Bulk meta titles + meta descriptions** for products: fill missing (default) or rewrite all.
3. **Core embedded UI**: start a job, live "142 of 500 images processed" progress, per-item failure list with reasons, "retry failed", job history with before/after values.
4. **One simple paid plan** through the Shopify Billing API, with whatever trial and limits the owner decides.
5. **App Store compliance**: GDPR webhooks, privacy policy, data-handling disclosure, listing assets, scopes justification.

Remaining work to finish v1:
- [ ] Owner decisions: name, price, plan limits, trial, AI model/cost ceiling (blocking billing + listing).
- [ ] Create the app in a Shopify Partner account, link it (`npm run config:link`), install on a development store.
- [ ] Real end-to-end verification (see [VERIFICATION.md](VERIFICATION.md)): install, a real bulk alt-text run on real products with images, real meta generation, uninstall and GDPR webhooks.
- [ ] Confirm the Admin API details this pass could not check live (shopify.dev is blocked from the build sandbox): `fileUpdate` for product image alt text and whether `write_files` is required, `productUpdate` with `seo`, query costs.
- [ ] Measure real per-image and per-product AI cost on a real catalog; set a per-shop monthly usage cap tied to the plan.
- [ ] Production hosting + Postgres (SQLite is dev-only), secrets, error monitoring, log retention.
- [ ] Undo: "Revert this job" using the stored before-values (the data is already captured; only the action and UI are missing).
- [ ] App Store listing: copy, screenshots, demo video, support contact, data-use answers.
- [ ] Load test with a large development-store catalog (thousands of images) to tune concurrency against Shopify and AI rate limits.

## Stage 2: after v1 ships

- Product description generation/rewrite (port Luxe+'s description logic; needs a review-before-publish flow because it replaces merchant-written copy).
- Collection meta titles/descriptions and collection image alt text.
- Preview/approve mode (generate into a review queue instead of writing directly).
- Per-shop brand voice and language settings; multi-language (Shopify Translate & Adapt) awareness.
- Scheduled "keep new products covered" runs (webhook on `products/create`).
- Additional plans / usage-based pricing, if the owner wants them.

## Stage 3: later

- Image features (the owner's "images possibly later"): e.g. background cleanup or resizing. Needs separate scoping for cost and quality.
- Blog/article SEO, SEO audit dashboard, bulk handle/URL fixes.
