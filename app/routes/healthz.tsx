import prisma from "../db.server";
import { checkConfig, resolveAppUrl } from "../config.server";

/**
 * Deployment diagnostics: which settings are present (names only, never
 * values), the URL the app believes it's served from, and whether the
 * database is reachable and migrated. Returns 200 only when everything
 * required is in place, so it doubles as an uptime check.
 */
export const loader = async () => {
  const config = checkConfig();
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
    appUrl: resolveAppUrl(),
    appUrlSource: process.env.SHOPIFY_APP_URL ? "SHOPIFY_APP_URL" : process.env.VERCEL_PROJECT_PRODUCTION_URL ? "VERCEL_PROJECT_PRODUCTION_URL" : null,
    config: config.map(({ name, ok, required, hint }) => ({ name, set: ok, required, ...(ok ? {} : { hint }) })),
    database,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
