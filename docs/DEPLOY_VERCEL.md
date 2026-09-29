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
| `BILLING_ENABLED` | leave unset until pricing is approved (docs/PRICING_PROPOSAL.md). `true` turns on plan limits and the upgrade/credit purchase buttons. Usage is counted either way |
| `BILLING_TEST` | leave unset (test charges). `false` only when charging for real |

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

## Troubleshooting: merchants see Vercel's "You Need Access" page

Cause: Shopify is sending merchants to a **per-deployment** address (like `bulk-seo-fuuf3pnyt-turbozzgeezzz-3546s-projects.vercel.app`) instead of the production domain. Every deployment gets one of these; Vercel's default Deployment Protection puts all of them behind a Vercel login. It works for you because you're logged in to Vercel; merchants aren't.

1. Find the production domain: Vercel → project → **Settings → Domains** (the one marked Production). Open `https://<that-domain>/healthz`; its `shopifyPartnerDashboardShouldHave` block lists every value below, already filled in.
2. Shopify Partner / Dev Dashboard → BulkFlow → **Configuration** (or **Versions → Create version**): set **App URL** and **Allowed redirection URL(s)** to those values, then **release** the version. Unreleased changes aren't used.
3. Vercel → **Settings → Environment Variables**: `SHOPIFY_APP_URL` must be the production domain, or deleted (the app then uses the production domain automatically). Since this commit, a per-deployment value is ignored and reported on `/healthz` as `appUrlProblem`.
4. Vercel → **Settings → Deployment Protection → Vercel Authentication**: must be **Standard Protection** (or off). "All Deployments" also locks the production domain, which blocks merchants and Shopify's webhooks. Password Protection and Trusted IPs must be off.
5. Test from a private/incognito window, not logged in to Vercel: open `https://<production-domain>/healthz` (you should see JSON, not a Vercel page), then install on the dev store.

## Troubleshooting: blank page that keeps reloading inside Shopify admin

Shopify's library answers every failed sign-in on a page load by fetching a new session token and reloading. If the failure is permanent that loops forever. BulkFlow now stops after a few seconds of this and shows a "BulkFlow can't start" page with the specific reason, also logged in Vercel as `[auth] …`:

| Page says | Meaning | Fix |
|---|---|---|
| The server's Client Secret doesn't match this app | `SHOPIFY_API_SECRET` isn't the app's current secret (e.g. it was rotated) | Copy the current Client Secret into Vercel, redeploy |
| This server is configured for a different Shopify app | `SHOPIFY_API_KEY` isn't the installed app's Client ID | Set Client ID + Secret of the installed app in Vercel, redeploy |
| Shopify never handed BulkFlow a session token | App Bridge couldn't get a token for the configured Client ID | Compare `clientId` on `/healthz` with the id in the admin URL |
| Shopify refuses to give BulkFlow access to this store | Token is valid but Shopify rejected the exchange; its exact answer is shown | Release an app version with the scopes and production App URL, then reinstall |

For more detail, set `SHOPIFY_LOG_LEVEL=debug` in Vercel and redeploy: the library's own auth reasoning then appears in the function logs.

If you still see a silent loop with none of these pages, the deployment serving your domain isn't running this code: check the `commit` on `/healthz` and redeploy the newest entry.

## Troubleshooting: grey loading screen that sits for minutes

Every step of an admin page load now has a deadline, so a stalled dependency shows an error page within about 20 seconds instead of a grey screen until Vercel kills the function (300 s, `FUNCTION_INVOCATION_TIMEOUT`):

| Step | Limit | Page / log |
|---|---|---|
| Shopify sign-in (session lookup, token exchange, refreshing an expired store token) | 20 s | "Shopify didn't respond while BulkFlow was signing in", `[auth] …` |
| Any single request the Shopify library sends (token calls, GraphQL) | 30 s | aborted; surfaces as the sign-in page above or "This page couldn't load" |
| Database connect / wait for a pooled connection | 10 s each | "This page couldn't load" |
| Any single database query | 15 s | "This page couldn't load" |
| Billing check on the Plan & usage page (only when `BILLING_ENABLED=true`) | 15 s | the page loads and says billing isn't available |

What the Vercel function logs show:

- `[timing] /app for <shop>: sign-in N ms, total N ms` on every admin page load. If this line never appears for a page load, the request isn't reaching the app at all (check the domain, and `/healthz`).
- `[slow] <step> still waiting after Ns (<shop>)` every 5 s while a step is stuck, which names the step.
