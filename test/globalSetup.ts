import { execSync } from "node:child_process";

// Runner tests use a real Postgres, the same engine as production. Point
// TEST_DATABASE_URL at a throwaway database; migrations are applied here and
// each runner test truncates the tables it uses.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to a throwaway Postgres database (see README).");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: url } });
}
