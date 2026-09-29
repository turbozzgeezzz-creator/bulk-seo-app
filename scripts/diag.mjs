#!/usr/bin/env node
/**
 * Reads /internal/diag for a shop: stored session state and recent sign-in
 * attempts with the Shopify library's reasoning (authTrace.server.ts).
 *
 *   SHOPIFY_API_SECRET=… node scripts/diag.mjs [--url https://bulk-seo-app.vercel.app] [--shop bulkflow-cwopi3ze.myshopify.com] [--limit 30]
 */
import { createHmac } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const baseUrl = (args.url ?? process.env.LIVE_APP_URL ?? "https://bulk-seo-app.vercel.app").replace(/\/$/, "");
const shop = args.shop ?? process.env.SHOP ?? "bulkflow-cwopi3ze.myshopify.com";
const secret = process.env.SHOPIFY_API_SECRET;
if (!secret) {
  console.error("Set SHOPIFY_API_SECRET (the app's current Client Secret).");
  process.exit(2);
}
const ts = Math.floor(Date.now() / 1000);
const sig = createHmac("sha256", secret).update(`${shop}:${ts}`).digest("hex");
const res = await fetch(`${baseUrl}/internal/diag?shop=${shop}&ts=${ts}&sig=${sig}&limit=${args.limit ?? 30}`);
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const d = await res.json();
console.log(`commit ${d.commit}  now ${d.now}  shop ${d.shop}`);
console.log(`sessions: ${JSON.stringify(d.sessions)}`);
console.log(`shop row: ${JSON.stringify(d.shopRow)}`);
console.log(`bounce counter: ${JSON.stringify(d.bounce)}`);
for (const e of d.events.reverse()) {
  console.log(`\n${e.at}  ${e.outcome.toUpperCase()}  ${e.ms} ms  ${e.path}`);
  for (const line of e.detail.split("\n")) console.log(`    ${line}`);
}
