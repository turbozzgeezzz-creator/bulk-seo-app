import prisma from "../db.server";
import type { LoaderFunctionArgs } from "react-router";
import { buildInfo, checkConfig, isPerDeploymentVercelHost, resolveAppUrlDetailed } from "../config.server";

/**
 * Deployment diagnostics: which settings are present (names only, never
 * values), the URL the app believes it's served from, and whether the
 * database is reachable and migrated. Returns 200 only when everything
 * required is in place, so it doubles as an uptime check.
 */
/** The exact values the Shopify app configuration must hold for this deployment. */
function shopifySettings(appUrl: string | null) {
  if (!appUrl) return null;
  return {
    appUrl,
    allowedRedirectionUrls: [`${appUrl}/auth/callback`, `${appUrl}/auth/shopify/callback`, `${appUrl}/api/auth/callback`],
    complianceWebhooks: {
      customerDataRequest: `${appUrl}/webhooks/customers/data_request`,
      customerDataErasure: `${appUrl}/webhooks/customers/redact`,
      shopDataErasure: `${appUrl}/webhooks/shop/redact`,
    },
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const servedFrom = new URL(request.url).host;
  const config = checkConfig();
  const appUrl = resolveAppUrlDetailed();
  let database: { ok: boolean; detail: string };
  if (!process.env.DATABASE_URL) {
    database = { ok: false, detail: "DATABASE_URL is not set." };
  } else {
    try {
      const rows = await prisma.$queryRaw<{ table: string }[]>`
        SELECT table_name AS "table" FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name IN ('Session', 'Shop', 'BulkJob', 'BulkJobItem')`;
      const found = new Set(rows.map((r) => r.table));
      const missingTables = ["Session", "Shop", "BulkJob", "BulkJobItem"].filter((t) => !found.has(t));
      database = missingTables.length
        ? { ok: false, detail: `Connected, but these tables are missing (migrations not applied): ${missingTables.join(", ")}.` }
        : { ok: true, detail: "Connected; all tables present." };
    } catch (err) {
      database = { ok: false, detail: `Could not connect: ${err instanceof Error ? err.message.split("\n").filter(Boolean).slice(-1)[0] : String(err)}` };
    }
  }

  const ok = database.ok && config.every((c) => !c.required || c.ok);
  const body = {
    ok,
    ...buildInfo(),
    appUrl: appUrl.url,
    appUrlSource: appUrl.source,
    ...(appUrl.problem ? { appUrlProblem: appUrl.problem } : {}),
    servedFrom,
    ...(isPerDeploymentVercelHost(servedFrom)
      ? {
          servedFromWarning:
            "You opened this through a per-deployment address. It only works for people logged in to Vercel; merchants get Vercel's \"You Need Access\" page. Shopify must only ever use the appUrl above.",
        }
      : {}),
    shopifyPartnerDashboardShouldHave: shopifySettings(appUrl.url),
    config: config.map(({ name, ok, required, hint }) => ({ name, set: ok, required, ...(ok ? {} : { hint }) })),
    database,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
