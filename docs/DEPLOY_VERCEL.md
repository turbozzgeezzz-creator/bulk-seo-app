# Deploying BulkFlow on Vercel

## 1. Database (one time)

Vercel project → **Storage** → **Create Database** → **Postgres** (Neon) → create it and **connect it to this project** for Production (and Preview, if you use previews). That sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically.

Every Vercel build then runs `npm run vercel-build`, which generates the Prisma client and applies pending migrations (`prisma migrate deploy`, non-destructive) before building. If `DATABASE_URL` is missing, the build fails with a message saying so. That's deliberate: the previous working deployment stays live instead of shipping one that can't store sessions.

## 2. Environment variables

Vercel project → **Settings → Environment Variables** (Production):

| Name | Value |
|---|---|
| `SHOPIFY_API_KEY` | `112d8cc57cd35b3baa6d4718b23c7f02` (the Client ID) |
| `SHOPIFY_API_SECRET` | the app's current Client Secret (mark as Sensitive) |
| `ANTHROPIC_API_KEY` | needed for generation jobs |
| `SHOPIFY_APP_URL` | `https://<production-domain>` (from Settings → Domains). If unset, the app falls back to Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, but setting it explicitly is recommended |

Variables only reach **new** deployments. After changing them, redeploy the **latest** deployment: Deployments → the top entry → ⋯ → Redeploy. Check the commit shown on that entry: "Redeploy" on an older entry rebuilds that older commit's code. `/healthz` shows the `commit` actually running.

## 3. Check it

Open `https://<production-domain>/healthz`. It returns 200 with `"ok": true` when every required setting is present and the database is migrated; otherwise 503 with the name of what's missing. Its `appUrl` field is the exact URL to give Shopify.

Use the **production domain** (Settings → Domains, e.g. `bulk-seo-app.vercel.app`), never a per-deployment URL like `bulk-seo-app-abc123-team.vercel.app`: those change on every deploy, and Vercel's default Deployment Protection puts them behind a Vercel login, which Shopify can't get through.

## 4. Shopify app settings

Partner/Dev Dashboard → BulkFlow → Configuration (or create a new app version):

- **App URL:** `https://<production-domain>`
- **Allowed redirection URL(s):**
  - `https://<production-domain>/auth/callback`
  - `https://<production-domain>/auth/shopify/callback`
  - `https://<production-domain>/api/auth/callback`
- **Embed app in Shopify admin:** on
- **Access scopes:** `read_products,write_products,write_files`
- **Compliance webhooks:**
  - Customer data request: `https://<production-domain>/webhooks/customers/data_request`
  - Customer data erasure: `https://<production-domain>/webhooks/customers/redact`
  - Shop data erasure: `https://<production-domain>/webhooks/shop/redact`

Alternatively, put the same URL in `shopify.app.toml` (`application_url`, plus `[auth] redirect_urls`) and run `npx shopify app deploy` from a machine with the Shopify CLI. That pushes the URLs, scopes and every webhook subscription in the toml (including `app/uninstalled`) in one step, and is the more reliable path.

BulkFlow uses Shopify-managed installation with token exchange, so the scopes that matter are the ones on the released app version, not a runtime variable.

## Background jobs on Vercel

Functions freeze once they respond, so bulk jobs run in chunks under `waitUntil`, and each chunk hands off to the next through a signed request to `/internal/jobs/:id/continue` on the production domain. The job page's 2-second poll also nudges the job. If Deployment Protection is extended to the production domain, the hand-off is refused (logged as HTTP 401/403) and jobs only advance while their page is open.
