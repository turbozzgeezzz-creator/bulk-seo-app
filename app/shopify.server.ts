import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { billingConfig } from "./billing.server";
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
export const authenticate = shopify.authenticate;
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
