import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { billingConfig } from "./billing.server";
import { describeProblem, diagnoseSessionToken, sessionTokenFromRequest } from "./lib/shopify/sessionTokenCheck.server";
import { DEFAULT_SCOPES, buildInfo, configErrorResponse, missingRequiredConfig, resolveAppUrlDetailed } from "./config.server";

const appUrl = resolveAppUrlDetailed();
const build = buildInfo();
console.log(
  `[config] BulkFlow starting: commit ${build.commit ?? "unknown"}, appUrl ${appUrl.url ?? "(none)"} from ${appUrl.source ?? "nowhere"}` +
    (build.deploymentUrl ? `, served from deployment ${build.deploymentUrl}` : ""),
);
if (appUrl.problem) console.error(`[config] ${appUrl.problem}`);
const missing = missingRequiredConfig();
if (missing.length) {
  console.error(`[config] BulkFlow is missing required environment variables: ${missing.join(", ")}. Admin pages will return 503 until they are set; see /healthz.`);
}
// Placeholders keep the server bundle loadable when config is missing, so
// public pages and /healthz still work and can say what's wrong. Pages that
// need Shopify access refuse to run while anything is missing (see requireConfig).
const PLACEHOLDER_URL = "https://bulkflow-app-url-not-configured.invalid";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "missing-api-key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "missing-api-secret",
  apiVersion: ApiVersion.October25,
  scopes: (process.env.SCOPES || DEFAULT_SCOPES).split(","),
  // Never "" or an invalid URL: either would make shopifyApp() throw while the
  // bundle loads and 500 every page. A missing URL is reported instead (see above).
  appUrl: appUrl.url || PLACEHOLDER_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: billingConfig,
  hooks: {
    afterAuth: async ({ session }) => {
      // One Shop row per installed store; reinstalling clears the uninstall marker.
      await prisma.shop.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop },
        update: { uninstalledAt: null },
      });
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
/**
 * authenticate.admin with one guard in front: if Shopify's session token was
 * signed for a different Client ID or with a different Client Secret than
 * this server is configured with, stop with a clear error instead of letting
 * the library bounce and reload forever (see sessionTokenCheck.server.ts).
 */
const admin: typeof shopify.authenticate.admin = async (request) => {
  const found = sessionTokenFromRequest(request);
  if (found) {
    const problem = diagnoseSessionToken(found.token, process.env.SHOPIFY_API_KEY, process.env.SHOPIFY_API_SECRET);
    if (problem) {
      const msg = describeProblem(problem, process.env.SHOPIFY_API_KEY ?? "");
      console.error(`[auth] ${msg.title}. ${msg.detail} Fix: ${msg.fix}`);
      throw sessionConfigErrorResponse(msg, found.isDocumentRequest);
    }
  }
  return shopify.authenticate.admin(request);
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function sessionConfigErrorResponse(msg: { title: string; detail: string; fix: string }, isDocumentRequest: boolean): Response {
  // 500, not a redirect or a 401: App Bridge retries 401s with a new token,
  // which is the loop we're breaking.
  if (!isDocumentRequest) {
    return new Response(JSON.stringify({ error: `${msg.title}. ${msg.detail}`, fix: msg.fix }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  // An HTML fragment: in a page loader, Shopify's boundary.error renders the
  // thrown Response's body inside the app layout (see app.tsx ErrorBoundary).
  const html = `<main style="max-width:640px;margin:48px auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 0 rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.06);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#303030">
<p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#8e1f0b;letter-spacing:.04em;text-transform:uppercase">BulkFlow can't start</p>
<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(msg.title)}</h1>
<p style="margin:0 0 12px">${escapeHtml(msg.detail)}</p>
<p style="margin:0;padding:12px;border-radius:8px;background:#fff1c7"><strong>How to fix:</strong> ${escapeHtml(msg.fix)}</p>
<p style="margin:16px 0 0;color:#616161;font-size:13px">This page is shown instead of reloading endlessly. Nothing in your store was changed.</p>
</main>`;
  return new Response(html, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const authenticate = { ...shopify.authenticate, admin };
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

/** Call first in any loader/action that needs Shopify or the database. */
export function requireConfig() {
  const stillMissing = missingRequiredConfig();
  if (stillMissing.length) {
    throw configErrorResponse(stillMissing);
  }
}
