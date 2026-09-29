import type { PrismaClient } from "@prisma/client";
import { describeProblem, diagnoseSessionToken } from "./sessionTokenCheck.server";

/**
 * Stops a silent embedded reload loop, whatever its cause, and says why.
 *
 * Shopify's library answers several different auth failures the same way on
 * a page load: redirect to its bounce page (/auth/session-token), which gets
 * a fresh session token and reloads. When the failure is permanent that
 * repeats about once a second forever: a blank page, with the reason logged
 * at debug level or not at all. Known permanent causes:
 *   - the token's signature/Client ID doesn't match this server's config;
 *   - Shopify rejects the token exchange (invalid_subject_token), which
 *     the library also treats as "get a new token and retry";
 *   - no token ever arrives because App Bridge on the bounce page can't get
 *     one for the configured Client ID.
 *
 * Legitimate flows bounce at most once or twice per page load (a first load
 * without a token, or an expired token). So more than BOUNCE_LIMIT bounces
 * for one shop inside WINDOW_MS means a loop: instead of redirecting again,
 * diagnose it and show the result.
 */

export const BOUNCE_LIMIT = 8;
export const WINDOW_MS = 45_000;

export function isBounceRedirect(res: unknown, bouncePath = "/auth/session-token"): res is Response {
  if (!(res instanceof Response)) return false;
  if (res.status < 300 || res.status >= 400) return false;
  const location = res.headers.get("location") ?? "";
  return location.startsWith(bouncePath) || location.includes(`${bouncePath}?`);
}

/** Records one bounce for the shop and returns how many there have been in the current window. */
export async function recordBounce(prisma: PrismaClient, shop: string, now = new Date()): Promise<number> {
  const existing = await prisma.authBounce.findUnique({ where: { shop } });
  if (!existing || now.getTime() - existing.windowStart.getTime() > WINDOW_MS) {
    await prisma.authBounce.upsert({ where: { shop }, create: { shop, count: 1, windowStart: now }, update: { count: 1, windowStart: now } });
    return 1;
  }
  const updated = await prisma.authBounce.update({ where: { shop }, data: { count: { increment: 1 } } });
  return updated.count;
}

export interface Diagnosis {
  title: string;
  detail: string;
  fix: string;
}

type Fetch = typeof fetch;

/**
 * Makes the same token-exchange request the library makes, to capture
 * Shopify's actual answer (the library discards it). Only runs after a loop
 * has been detected, never on normal requests.
 */
export async function probeTokenExchange(
  shop: string,
  sessionToken: string,
  apiKey: string,
  apiSecret: string,
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true } | { ok: false; status: number; error: string; description: string }> {
  try {
    const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: sessionToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
        expiring: "1",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const text = await res.text();
    let error = "";
    let description = "";
    try {
      const body = JSON.parse(text) as { error?: string; error_description?: string; errors?: unknown };
      error = body.error ?? "";
      description = body.error_description ?? (body.errors ? JSON.stringify(body.errors) : "");
    } catch {
      description = text.slice(0, 300);
    }
    return { ok: false, status: res.status, error, description };
  } catch (err) {
    return { ok: false, status: 0, error: "network", description: err instanceof Error ? err.message : String(err) };
  }
}

export async function diagnoseLoop(
  params: { shop: string; sessionToken: string | null; apiKey: string; apiSecret: string },
  fetchImpl: Fetch = fetch,
): Promise<Diagnosis> {
  const { shop, sessionToken, apiKey, apiSecret } = params;

  if (!sessionToken) {
    return {
      title: "Shopify never handed BulkFlow a session token",
      detail: `The app kept reloading without a session token for ${shop}. App Bridge gets that token from Shopify for the Client ID the server is configured with (SHOPIFY_API_KEY = ${apiKey}); if that isn't the app you opened, it can't get one.`,
      fix: `Compare ${apiKey} with the id in the admin address bar (admin.shopify.com/store/…/apps/<id>). If they differ, set SHOPIFY_API_KEY and SHOPIFY_API_SECRET in Vercel to that app's Client ID and Client Secret (Shopify Partner Dashboard → BulkFlow → Client credentials), then redeploy.`,
    };
  }

  const tokenProblem = diagnoseSessionToken(sessionToken, apiKey, apiSecret);
  if (tokenProblem) return describeProblem(tokenProblem, apiKey);

  const probe = await probeTokenExchange(shop, sessionToken, apiKey, apiSecret, fetchImpl);
  if (probe.ok) {
    return {
      title: "Sign-in kept restarting, but Shopify now accepts it",
      detail: "The session token is valid and Shopify accepted the token exchange on this attempt, so the repeated restarts came from somewhere else (for example a request that expired in flight).",
      fix: "Reload the app once. If it loops again, set SHOPIFY_LOG_LEVEL=debug in Vercel, redeploy, reproduce, and send the Vercel function logs from that minute.",
    };
  }
  const shopifySays = [probe.error, probe.description].filter(Boolean).join(": ") || `HTTP ${probe.status}`;
  if (probe.error === "invalid_subject_token" || probe.error === "invalid_client" || probe.status === 401) {
    return {
      title: "Shopify refuses to give BulkFlow access to this store",
      detail: `The session token is signed correctly, but Shopify rejected exchanging it for store access (HTTP ${probe.status}). Shopify says: "${shopifySays}".`,
      fix:
        probe.error === "invalid_client"
          ? "Shopify doesn't accept the Client ID / Client Secret pair. Copy both again from the Partner Dashboard (BulkFlow → Client credentials) into Vercel, then redeploy."
          : "Usually the released app version doesn't grant the access BulkFlow needs, or the install didn't finish. In the Partner Dashboard, check the released version lists the scopes read_products, write_products, write_files and uses the production App URL; release it, then uninstall BulkFlow from the store and install it again.",
    };
  }
  return {
    title: "Sign-in keeps failing at the token exchange step",
    detail: `Shopify answered the token exchange with HTTP ${probe.status || "no response"}. Details: "${shopifySays}".`,
    fix: "If this mentions the network, it may be temporary: wait a minute and reload. Otherwise send this message along; it's Shopify's exact answer.",
  };
}
