# Power features: proposed stages (for the app owner to prioritise)

Rough effort is focused engineering time including tests and UI, not calendar time. Nothing here is built yet.

| # | Feature | Effort | Value | New Shopify access needed | Business decisions it raises |
|---|---|---|---|---|---|
| 0 | Per-call AI token logging | ½ day | Turns pricing estimates into measured costs | none | – |
| 1 | SEO health score + trend dashboard | 2–4 days | High: shows value every visit, drives upgrades | none (reuses the catalog scan) | What the score weighs |
| 2 | Collection SEO (meta titles/descriptions for collections) | 1–2 days | Medium: quick win, same engine as product meta | none (`read_products`/`write_products` cover collections) | Does a collection count as one item? |
| 3 | Scheduled / automatic runs for new products | 3–5 days | High: "set and forget" is what keeps merchants subscribed | `products/create` webhook | On by default? Which plans? |
| 4 | Review before publish (approve changes before they go live) | 3–4 days | High for trust; a prerequisite for 5 | none | Default on or off |
| 5 | Product description generation | 5–8 days | High, but visible copy: needs 4 first | none | Priced as several items (longer, pricier AI calls) |
| 6 | Multi-language (write in each store language) | 1–2 weeks | High for multi-market stores | `read_translations`, `write_translations`, `read_locales` | Each language counts as its own item |

## Recommended order

**Stage 1, about one week:** 0 + 1 + 2. Measured costs, a health score merchants see on the dashboard (catalog coverage for alt text, meta titles, meta descriptions, and length quality, snapshotted daily so it shows improvement over time), and collections.

**Stage 2, about 1½ weeks:** 3 + 4. New products are handled automatically (webhook for new products plus a nightly catch-up, counted against the plan like any job), and merchants can choose to approve changes before they're written.

**Stage 3, 2–3 weeks:** 5 + 6. Product descriptions (through the review step, with brand-voice settings and HTML sanitising) and multi-language via Shopify's Translations API.

## Notes

- Everything above runs on the existing job engine (bounded chunks, verified writes, per-item reasons, usage metering), so each feature inherits progress, retries and billing.
- 3 and 6 need new webhooks/scopes in `shopify.app.toml` and a new released app version; merchants approve new scopes on their next open.
- 5 and 6 multiply AI cost per merchant; settle their pricing (item weight) before building.
