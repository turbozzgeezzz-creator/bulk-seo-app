#!/usr/bin/env node
/**
 * Drives the Plan & usage page of a LOCAL server in real Chromium: load it,
 * click "Upgrade to <plan>", then "Buy credits", screenshotting each step and
 * printing where each click led (Shopify's approval page, or the error Shopify
 * returned). The server makes real Shopify Billing API calls.
 *
 *   SHOPIFY_API_KEY=… SHOPIFY_API_SECRET=… node scripts/billing-flow.mjs --url http://localhost:3457 --out shots/billing [--plan Growth]
 */
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const baseUrl = (args.url ?? "http://localhost:3457").replace(/\/$/, "");
const shop = args.shop ?? "bulkflow-cwopi3ze.myshopify.com";
const out = args.out ?? "shots/billing";
const planLabel = args.plan ?? "Growth";
mkdirSync(out, { recursive: true });
const { SHOPIFY_API_KEY: apiKey, SHOPIFY_API_SECRET: secret } = process.env;
const token = () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: apiKey, sub: "1", exp: now + 60, nbf: now - 5, iat: now, jti: randomUUID(), sid: randomUUID() });
  return `${h}.${b}.${createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`;
};
const host = Buffer.from(`admin.shopify.com/store/${shop.replace(".myshopify.com", "")}`).toString("base64url");
const pageUrl = () => `${baseUrl}/app/billing?embedded=1&shop=${shop}&host=${host}&id_token=${token()}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" });
await ctx.route("**/shopifycloud/app-bridge.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "window.shopify={idToken:async()=>''};" }));
const page = await ctx.newPage();
await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
  const s = document.createElement("style");
  s.textContent = "s-app-nav{display:none!important}";
  document.head.appendChild(s);
}));
const banners = async () => (await page.locator("s-banner").allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);

async function step(name, act) {
  const responses = [];
  const onResponse = (r) => { if (r.url().startsWith(baseUrl) && r.request().method() === "POST") responses.push(`${r.status()} ${r.headers()["location"] ?? r.headers()["x-shopify-api-request-failure-reauthorize-url"] ?? ""}`.trim()); };
  page.on("response", onResponse);
  await act();
  await page.waitForTimeout(2500);
  page.off("response", onResponse);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  console.log(`\n== ${name}`);
  console.log(`   url: ${page.url().replace(/id_token=[^&]+/, "id_token=…")}`);
  for (const r of responses) console.log(`   POST -> ${r}`);
  for (const b of await banners()) console.log(`   banner: ${b}`);
}

await step("1-billing-page", () => page.goto(pageUrl(), { waitUntil: "networkidle" }));
await step(`2-upgrade-${planLabel.toLowerCase()}`, () => page.getByRole("button", { name: `Upgrade to ${planLabel}` }).click());
await page.goto(pageUrl(), { waitUntil: "networkidle" });
await step("3-buy-credits", () => page.getByRole("button", { name: "Buy credits" }).first().click());
await browser.close();
