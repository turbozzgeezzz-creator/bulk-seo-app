#!/usr/bin/env node
/**
 * End-to-end check of the embedded admin page against a running BulkFlow
 * (normally the production Vercel URL), without Shopify admin in the loop.
 *
 * It does what Shopify admin does when a merchant opens the app: signs a
 * session token for the store with the app's Client Secret and loads
 * /app?shop=…&host=…&embedded=1&id_token=… in a real Chromium. The server
 * then runs its real sign-in path (database session lookup, and a real token
 * exchange with Shopify when the stored token is missing or expired).
 *
 * Records /healthz, every network request with status and timing, console
 * messages, page errors, the visible text, and a screenshot.
 *
 *   SHOPIFY_API_KEY=… SHOPIFY_API_SECRET=… node scripts/live-check.mjs \
 *     [--url https://bulk-seo-app.vercel.app] [--shop bulkflow-cwopi3ze.myshopify.com] \
 *     [--path /app] [--user <Shopify staff user id>] [--out live-check-out]
 *
 * --user: the session token's `sub`. Shopify's token exchange may reject a
 * made-up user id, so pass a real staff user id of the store if an exchange
 * is needed (the server log / page says so). Not needed while the store's
 * stored offline session is still valid.
 */
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const baseUrl = (args.url ?? process.env.LIVE_APP_URL ?? "https://bulk-seo-app.vercel.app").replace(/\/$/, "");
const shop = args.shop ?? process.env.SHOP ?? "bulkflow-cwopi3ze.myshopify.com";
const path = args.path ?? "/app";
const userId = args.user ?? process.env.SHOPIFY_USER_ID ?? "1";
const outDir = args.out ?? "live-check-out";
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;
if (!apiKey || !apiSecret) {
  console.error("Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET (the app's Client ID and current Client Secret).");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(6)} ms`;
const log = (line) => console.log(`${at()}  ${line}`);

function sessionToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: apiKey,
    sub: userId,
    exp: now + 60,
    nbf: now - 5,
    iat: now,
    jti: randomUUID(),
    sid: randomUUID(),
  });
  return `${head}.${body}.${createHmac("sha256", apiSecret).update(`${head}.${body}`).digest("base64url")}`;
}

// 1. Which build is live, and is its config complete?
try {
  const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(20_000) });
  const health = await res.json();
  writeFileSync(join(outDir, "healthz.json"), JSON.stringify(health, null, 2));
  log(`/healthz HTTP ${res.status}: commit ${health.commit ?? "?"}, ok ${health.ok}, appUrl ${health.appUrl}, database ${JSON.stringify(health.database)}`);
  if (health.appUrlProblem) log(`  appUrlProblem: ${health.appUrlProblem}`);
} catch (err) {
  log(`/healthz failed: ${err}`);
}

// 2. Open the embedded page the way Shopify admin's iframe does.
const host = Buffer.from(`admin.shopify.com/store/${shop.replace(".myshopify.com", "")}`).toString("base64url");
const url = `${baseUrl}${path}?embedded=1&shop=${shop}&host=${host}&id_token=${sessionToken()}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
// A regular desktop Chrome user agent: the Shopify library answers
// "HeadlessChrome" with 410 Gone (bot filter), which a merchant never sees.
const page = await browser.newPage({
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});
const requests = [];
const started = new Map();
page.on("request", (r) => started.set(r, Date.now()));
page.on("requestfinished", async (r) => {
  const res = await r.response();
  const row = { method: r.method(), url: r.url().replace(/id_token=[^&]+/, "id_token=…"), status: res?.status(), ms: Date.now() - started.get(r) };
  requests.push(row);
  log(`${row.method} ${row.status} ${String(row.ms).padStart(5)} ms  ${row.url.slice(0, 140)}`);
});
page.on("requestfailed", (r) => {
  const row = { method: r.method(), url: r.url().replace(/id_token=[^&]+/, "id_token=…"), failure: r.failure()?.errorText, ms: Date.now() - started.get(r) };
  requests.push(row);
  log(`${row.method} FAILED ${row.failure} after ${row.ms} ms  ${row.url.slice(0, 140)}`);
});
page.on("console", (m) => log(`console.${m.type()}: ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => log(`pageerror: ${e.message.slice(0, 300)}`));

let outcome = "loaded";
const navStart = Date.now();
try {
  const res = await page.goto(url, { waitUntil: "load", timeout: 330_000 });
  log(`document HTTP ${res?.status()} in ${Date.now() - navStart} ms`);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => log("network not idle after 20 s (continuing)"));
} catch (err) {
  outcome = `navigation failed: ${String(err).split("\n")[0]}`;
  log(outcome);
}
const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
await page.screenshot({ path: join(outDir, "page.png"), fullPage: true }).catch(() => {});
writeFileSync(join(outDir, "page.html"), await page.content().catch(() => ""));
writeFileSync(join(outDir, "requests.json"), JSON.stringify(requests, null, 2));
await browser.close();

log(`final URL path: ${new URL(page.url()).pathname}`);
log(`visible text: ${text.slice(0, 400) || "(none: blank page)"}`);
const verdict = /BulkFlow can.t start|couldn.t load|Application Error/i.test(text)
  ? "ERROR PAGE"
  : text.includes("Dashboard") || text.includes("BulkFlow")
    ? "APP LOADED"
    : "BLANK OR UNKNOWN";
log(`RESULT: ${verdict} (${outcome}); outputs in ${outDir}/`);
process.exit(verdict === "APP LOADED" ? 0 : 1);
