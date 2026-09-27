import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Catches the one misconfiguration that makes the embedded app reload
 * forever instead of failing visibly.
 *
 * Shopify signs every session token with the app's Client Secret and
 * addresses it (aud) to the app's Client ID. When SHOPIFY_API_SECRET or
 * SHOPIFY_API_KEY on the server doesn't match the app the merchant opened,
 * the Shopify library treats each token as invalid and redirects to its
 * bounce page, which fetches a fresh token (equally "invalid") and reloads:
 * a blank page reloading about once a second, with nothing above debug level
 * in the logs.
 *
 * This checks those two things before the library sees the token. Anything
 * else (expiry, malformed tokens, other claims) is left to the library, whose
 * bounce-and-retry is the correct response for a merely stale token.
 */

export type SessionTokenProblem = { kind: "client-id-mismatch"; tokenClientId: string } | { kind: "secret-mismatch"; tokenClientId: string };

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function diagnoseSessionToken(token: string, apiKey: string | undefined, apiSecret: string | undefined): SessionTokenProblem | null {
  if (!apiKey || !apiSecret) return null; // missing config is reported elsewhere (requireConfig)
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = b64urlJson(headerPart);
  const payload = b64urlJson(payloadPart);
  if (!header || !payload || header.alg !== "HS256") return null;

  const aud = typeof payload.aud === "string" ? payload.aud : "";
  if (aud && aud !== apiKey) return { kind: "client-id-mismatch", tokenClientId: aud };

  const expected = createHmac("sha256", apiSecret).update(`${headerPart}.${payloadPart}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signaturePart, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { kind: "secret-mismatch", tokenClientId: aud || apiKey };
  }
  return null;
}

export function sessionTokenFromRequest(request: Request): { token: string; isDocumentRequest: boolean } | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return { token: auth.slice(7).trim(), isDocumentRequest: false };
  const param = new URL(request.url).searchParams.get("id_token");
  return param ? { token: param, isDocumentRequest: true } : null;
}

export function describeProblem(problem: SessionTokenProblem, apiKey: string): { title: string; detail: string; fix: string } {
  if (problem.kind === "client-id-mismatch") {
    return {
      title: "This server is configured for a different Shopify app",
      detail: `Shopify opened the app with Client ID ${problem.tokenClientId}, but the server's SHOPIFY_API_KEY is ${apiKey}.`,
      fix: `In Vercel → Settings → Environment Variables, set SHOPIFY_API_KEY to ${problem.tokenClientId} and SHOPIFY_API_SECRET to that app's Client Secret (Shopify Partner Dashboard → BulkFlow → Client credentials), then redeploy.`,
    };
  }
  return {
    title: "The server's Client Secret doesn't match this app",
    detail: `Shopify's session token for app ${problem.tokenClientId} is signed with a different secret than the server's SHOPIFY_API_SECRET. This usually means the secret was rotated in Shopify but not updated on the server.`,
    fix: "Copy the current Client Secret from the Shopify Partner Dashboard (BulkFlow → Client credentials) into SHOPIFY_API_SECRET in Vercel → Settings → Environment Variables, then redeploy.",
  };
}
