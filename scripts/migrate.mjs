// Applies pending Prisma migrations (non-destructive `migrate deploy`).
// Runs during the Vercel build so a deployment never goes live against an
// unmigrated database. Uses the direct (unpooled) connection when the host
// provides one, since migrations need a session-level connection that
// Neon/PgBouncer's pooled endpoint doesn't give.
import { execSync } from "node:child_process";

const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!direct) {
  console.error(
    "\n[migrate] DATABASE_URL is not set, so the database can't be migrated and the app can't store sessions.\n" +
      "[migrate] On Vercel: open the project → Storage → Create Database → Postgres (Neon) → connect it to this project,\n" +
      "[migrate] then redeploy. See docs/DEPLOY_VERCEL.md.\n",
  );
  process.exit(1);
}
execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: direct } });
