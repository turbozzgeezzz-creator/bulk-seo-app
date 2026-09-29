#!/usr/bin/env node
/**
 * Screenshots of the embedded admin screens from a LOCAL server, in real
 * Chromium, the way Shopify admin loads them (signed session token). App
 * Bridge's script is blocked so the page stays put outside Shopify admin
 * (otherwise it moves the window to admin.shopify.com); Polaris loads normally.
 *
 *   SHOPIFY_API_KEY=… SHOPIFY_API_SECRET=… node scripts/screens.mjs --url http://localhost:3457 --out shots/after [--paths /app,/app/new,/app/jobs] [--width 1280]
 */
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const baseUrl = (args.url ?? "http://localhost:3457").replace(/\/$/, "");
const shop = args.shop ?? "bulkflow-cwopi3ze.myshopify.com";
const out = args.out ?? "shots";
const width = Number(args.width ?? 1280);
const paths = (args.paths ?? "/app,/app/new,/app/jobs").split(",");
const { SHOPIFY_API_KEY: apiKey, SHOPIFY_API_SECRET: secret } = process.env;
mkdirSync(out, { recursive: true });

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: apiKey, sub: "1", exp: now + 60, nbf: now - 5, iat: now, jti: randomUUID(), sid: randomUUID() });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({
  viewport: { width, height: 900 },
  deviceScaleFactor: 1,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});
await ctx.route("**/shopifycloud/app-bridge.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "window.shopify={idToken:async()=>''};" }));
// Demo product photos (seed-demo.mjs): simple generated product shots.
const palette = [["#e9dcc9", "#b08d63"], ["#dfe7ef", "#58708a"], ["#e3eadf", "#6d7f58"], ["#f1ece4", "#9a8f80"], ["#efe2dc", "#9b5b43"], ["#e4e4e4", "#2d2d2d"]];
await ctx.route("https://demo-images.bulkflow.test/**", (r) => {
  const n = Number(r.request().url().match(/(\d+)\.svg/)?.[1] ?? 0);
  const [bg, fg] = palette[n % palette.length];
  const shape = [
    `<path d="M80 70 L120 55 L160 70 L175 120 L160 125 L158 200 L82 200 L80 125 L65 120 Z" fill="${fg}"/>`,
    `<rect x="70" y="95" width="100" height="85" rx="12" fill="${fg}"/><path d="M95 95 v-18 a25 25 0 0 1 50 0 v18" stroke="${fg}" stroke-width="10" fill="none"/>`,
    `<path d="M85 90 h70 l-8 100 h-54 z" fill="${fg}"/><path d="M155 110 a22 22 0 0 1 0 44" stroke="${fg}" stroke-width="10" fill="none"/>`,
  ][n % 3];
  r.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="${bg}"/><ellipse cx="120" cy="208" rx="62" ry="8" fill="rgba(0,0,0,.08)"/>${shape}</svg>` });
});
const page = await ctx.newPage();
// Outside Shopify admin the app nav would render as plain links above the page; admin draws it in its sidebar.
await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent = "s-app-nav{display:none!important}";
  document.head.appendChild(style);
}));
page.on("pageerror", (e) => console.log(`  pageerror: ${e.message.slice(0, 200)}`));
const host = Buffer.from(`admin.shopify.com/store/${shop.replace(".myshopify.com", "")}`).toString("base64url");
for (const p of paths) {
  const res = await page.goto(`${baseUrl}${p}${p.includes("?") ? "&" : "?"}embedded=1&shop=${shop}&host=${host}&id_token=${token()}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(Number(args.wait ?? 1800));
  const name = p.replace(/^\/|\/$/g, "").replace(/[/?=&]/g, "_") || "root";
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`${res?.status()} ${p} -> ${file}`);
}
await browser.close();
