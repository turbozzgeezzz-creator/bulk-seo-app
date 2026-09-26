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

## Why the real install can't run from the Claude cloud sandbox

Checked on 2026-09-26: the sandbox's network policy blocks every Shopify host (`accounts.shopify.com`, `partners.shopify.com`, `admin.shopify.com`, `*.myshopify.com`, `cdn.shopify.com`, `shopify.dev`) and every tunnel service (`trycloudflare.com`, `argotunnel.com`, `ngrok.com`). Allow-listing the Shopify hosts would fix outbound calls, but OAuth and webhooks also need Shopify to reach the app at a public URL, which a sandbox container doesn't have. So the first real install has to run either on a developer machine (`npm run dev`, below) or on a deployed host.

## Steps to verify on a development store (on your own machine)

Prerequisites: Node 22+, the Shopify CLI (`npm i -g @shopify/cli`), a Partner account with access to the BulkFlow app, and an Anthropic API key.

```sh
git clone https://github.com/turbozzgeezzz-creator/bulk-seo-app.git && cd bulk-seo-app
npm install
cp .env.example .env          # then fill in ANTHROPIC_API_KEY (the CLI supplies the Shopify values)
npx prisma migrate deploy
npm run dev                   # log in to the Partner account when prompted, pick the BulkFlow app and the dev store
```

The CLI prints a preview URL; open it to see the real OAuth install screen for the dev store.

1. In the dev store, make sure there are products with photos, including one with no photos, one with 60+ photos, and one whose photo is deliberately wrong.
2. Install through the preview URL. Record: the OAuth screen, the requested scopes, the app opening inside admin.
3. Run "Fill in missing alt text". Record: scan progress, "N of M processed", the finished job page. Open a few products in admin and check the alt text matches what the job page shows.
4. Run "Fill in missing meta tags". Check a few products' "Search engine listing" section in admin.
5. Test failure honesty: temporarily set an invalid `ANTHROPIC_API_KEY` and start a job. It should stop with "rejected the app's API credentials" and change nothing.
6. Uninstall. Check the running job (if any) shows "uninstalled", sessions are gone, and trigger `shopify app webhook trigger --topic shop/redact` to check all shop data is deleted.
7. Settle the two open API questions, and record the answers in `docs/PORTING_NOTES.md`:
   - **Is `write_files` needed?** Remove `write_files` from `scopes` in `shopify.app.toml`, run `npm run dev` again (it re-prompts for scopes), and run an alt-text job. If items fail with an access-denied error from `fileUpdate`, the scope is required; put it back.
   - **How does `fileUpdate` behave?** On the job page, check the "Latest updates" rows. Each one is only there if the alt text read back from Shopify matched what was sent. Also check whether any items show "accepted the update but … reads back as" (that would mean the write is asynchronous and the read-back needs a short delay).
