import "@shopify/shopify-app-react-router/adapters/node";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import {
  ApiVersion,
  AppDistribution,
  LogSeverity,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { billingConfig } from "./billing.server";
import { describeProblem, diagnoseSessionToken, sessionTokenFromRequest } from "./lib/shopify/sessionTokenCheck.server";
import { BOUNCE_LIMIT, diagnoseLoop, isBounceRedirect, recordBounce } from "./lib/shopify/authLoopGuard.server";
import { DEFAULT_SCOPES, buildInfo, configErrorResponse, missingRequiredConfig, resolveAppUrlDetailed } from "./config.server";
import { StepTimeoutError, fetchWithTimeout, withDeadline } from "./lib/deadline.server";
import { type AuthOutcome, libraryLogFunction, recordAuthEvent, withLibraryLogCapture } from "./lib/shopify/authTrace.server";

/**
 * Every request the Shopify library makes (token exchange, token refresh,
 * GraphQL) goes through this fetch. Node's fetch otherwise waits up to 300 s
 * for a response, the same as Vercel's function limit, so a stalled call
 * held the embedded page blank for ~5 minutes. SHOPIFY_FETCH_TIMEOUT_MS is
 * deliberately longer than SIGN_IN_DEADLINE_MS below, so a stalled sign-in
 * reports itself clearly first and this only frees the connection.
 */
export const SHOPIFY_FETCH_TIMEOUT_MS = 30_000;
export const SIGN_IN_DEADLINE_MS = 20_000;
setAbstractFetchFunc(fetchWithTimeout(SHOPIFY_FETCH_TIMEOUT_MS));

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
  // The library logs at debug level so each sign-in's reasoning (e.g. why a
  // session token was rejected) is kept in its trace (authTrace.server.ts);
  // what's printed to the Vercel logs is info, or debug with SHOPIFY_LOG_LEVEL=debug.
  logger: {
    level: LogSeverity.Debug,
    log: libraryLogFunction(process.env.SHOPIFY_LOG_LEVEL === "debug" ? LogSeverity.Debug : LogSeverity.Info),
  },
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
const admin: typeof shopify.authenticate.admin = (request) =>
  withLibraryLogCapture(async (lines) => {
    const started = Date.now();
    const trace = { outcome: "error" as AuthOutcome, notes: [] as string[] };
    const shop = shopFromRequest(request);
    const note = () =>
      shop
        ? recordAuthEvent(prisma, {
            shop,
            path: new URL(request.url).pathname + (request.headers.get("authorization") ? " (data request)" : " (page load)"),
            outcome: trace.outcome,
            ms: Date.now() - started,
            detail: [`commit ${buildInfo().commit ?? "unknown"}`, ...trace.notes, ...lines],
          })
        : Promise.resolve();
    try {
      const result = await adminWithGuards(request, trace);
      trace.outcome = "ok";
      await note();
      return result;
    } catch (err) {
      if (err instanceof Response) {
        trace.notes.push(`answered HTTP ${err.status}${err.headers.get("location") ? ` -> ${err.headers.get("location")!.split("?")[0]}` : ""}`);
        if (trace.outcome === "error") {
          if (isBounceRedirect(err)) trace.outcome = "bounce";
          else if ((err as Response).status < 300) trace.outcome = new URL(request.url).pathname.startsWith("/auth/session-token") ? "bounce-page" : "responded";
        }
      } else {
        trace.notes.push(`threw ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      }
      await note();
      throw err;
    }
  });

function shopFromRequest(request: Request): string | null {
  const param = new URL(request.url).searchParams.get("shop");
  if (param) return param;
  const token = sessionTokenFromRequest(request)?.token;
  try {
    const dest = JSON.parse(Buffer.from(token?.split(".")[1] ?? "", "base64url").toString("utf8")).dest as string;
    return new URL(dest).hostname;
  } catch {
    return null;
  }
}

async function adminWithGuards(request: Request, trace: { outcome: AuthOutcome; notes: string[] }) {
  const found = sessionTokenFromRequest(request);
  trace.notes.push(found ? `session token in ${found.isDocumentRequest ? "id_token param" : "Authorization header"}` : "no session token");
  if (found) {
    const problem = diagnoseSessionToken(found.token, process.env.SHOPIFY_API_KEY, process.env.SHOPIFY_API_SECRET);
    if (problem) {
      const msg = describeProblem(problem, process.env.SHOPIFY_API_KEY ?? "");
      console.error(`[auth] ${msg.title}. ${msg.detail} Fix: ${msg.fix}`);
      trace.outcome = "config-error";
      trace.notes.push(msg.title);
      throw sessionConfigErrorResponse(msg, found.isDocumentRequest);
    }
  }
  const shopParam = new URL(request.url).searchParams.get("shop") ?? "unknown shop";
  const started = Date.now();
  try {
    const result = await withDeadline("Shopify sign-in", SIGN_IN_DEADLINE_MS, () => shopify.authenticate.admin(request), shopParam);
    const took = Date.now() - started;
    if (took > 2_000) console.warn(`[timing] Shopify sign-in took ${took} ms for ${shopParam}`);
    return result;
  } catch (err) {
    if (err instanceof StepTimeoutError) {
      const msg = {
        title: "Shopify didn't respond while BulkFlow was signing in",
        detail: `Signing in to ${shopParam} (checking the stored session, and renewing store access with Shopify if it had expired) didn't finish within ${Math.round(SIGN_IN_DEADLINE_MS / 1000)} seconds, so BulkFlow stopped waiting instead of leaving a blank page.`,
        fix: "Reload the app. If it happens again, check status.shopify.com, then send the Vercel log lines starting with [slow] and [auth] from that minute.",
      };
      console.error(`[auth] ${msg.title}. ${msg.detail}`);
      trace.outcome = "timeout";
      throw sessionConfigErrorResponse(msg, !request.headers.get("authorization"));
    }
    // A redirect to the bounce page is normally one step of sign-in. Many in
    // a row for the same shop is the silent reload loop: stop and explain.
    if (isBounceRedirect(err)) {
      const shop = new URL(request.url).searchParams.get("shop");
      if (shop) {
        const count = await recordBounce(prisma, shop).catch(() => 0);
        trace.notes.push(`sign-in restart ${count} for this shop in the current window`);
        if (count > BOUNCE_LIMIT) {
          const diagnosis = await diagnoseLoop({
            shop,
            sessionToken: found?.token ?? null,
            apiKey: process.env.SHOPIFY_API_KEY ?? "",
            apiSecret: process.env.SHOPIFY_API_SECRET ?? "",
          });
          console.error(`[auth] Reload loop stopped for ${shop} after ${count} sign-in restarts. ${diagnosis.title}. ${diagnosis.detail} Fix: ${diagnosis.fix}`);
          trace.outcome = "loop-stopped";
          trace.notes.push(`${diagnosis.title}. ${diagnosis.detail}`);
          throw sessionConfigErrorResponse(diagnosis, !request.headers.get("authorization"));
        }
      }
    }
    throw err;
  }
}

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
  // An HTML fragment: in a page loader, the app layout's ErrorBoundary renders the
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
