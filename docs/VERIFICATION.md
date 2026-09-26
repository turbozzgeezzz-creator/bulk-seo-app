# Verification status and how to finish it

## Verified in the build sandbox

- `npm run typecheck`, `npm run lint`, `npm run build`: pass.
- `npm test`: 51 tests pass. They cover the alt-text/meta hard gate, image fetch retry/timeout/format handling, per-item processors against an in-memory fake Shopify store with real write + read-back, and the job runner against a real SQLite database (full catalog scan with pagination, >50 images per product, only-missing mode, exact progress counts, retry then give-up, fatal stop, single-worker claim, cancel, retry-failed, per-shop isolation).
- Built server smoke test: `/` and `/privacy` render (200), a forged `shop/redact` webhook is rejected (401).

## Not verified yet (could not be done from the sandbox)

The sandbox has no Shopify Partner account or development store, no Anthropic API key, and its network policy blocks `shopify.dev` and `cdn.shopify.com`. So these have **not** been run for real:

- a real OAuth install on a development store;
- a real bulk alt-text run against real products and the real Claude API;
- real meta title/description generation from real product data;
- the exact Admin API behaviour of `fileUpdate` alt writes and the need for the `write_files` scope.

## Steps to verify on a development store

1. In the Shopify Partner Dashboard, create an app and a development store (free). Add some products with photos, including one with no photos, one with 60+ photos, and one whose photo is deliberately wrong.
2. `npm install`, then `npm run config:link` to link `shopify.app.toml` to the Partner app.
3. Set `ANTHROPIC_API_KEY` in `.env` (and optionally `AI_MODEL`).
4. `npm run dev` (Shopify CLI tunnels the app and opens the install screen). Install. Record: the OAuth screen, the requested scopes, the app opening inside admin.
5. Run "Fill in missing alt text". Record: scan progress, "N of M processed", the finished job page. Open a few products in admin and check the alt text matches what the job page shows.
6. Run "Fill in missing meta tags". Check a few products' "Search engine listing" section in admin.
7. Test failure honesty: temporarily set an invalid `ANTHROPIC_API_KEY` and start a job. It should stop with "rejected the app's API credentials" and change nothing.
8. Uninstall. Check the running job (if any) shows "uninstalled", sessions are gone, and trigger `shopify app webhook trigger --topic shop/redact` to check all shop data is deleted.
