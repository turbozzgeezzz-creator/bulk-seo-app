import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { describeProblem, diagnoseSessionToken, sessionTokenFromRequest } from "../app/lib/shopify/sessionTokenCheck.server";

const KEY = "112d8cc57cd35b3baa6d4718b23c7f02";
const SECRET = "current-client-secret";

function token(secret: string, claims: Record<string, unknown> = {}) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: "https://s.myshopify.com/admin", dest: "https://s.myshopify.com", aud: KEY, sub: "1", exp: now + 60, nbf: now, iat: now, ...claims });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

describe("diagnoseSessionToken", () => {
  it("accepts a token for this app signed with the configured secret", () => {
    expect(diagnoseSessionToken(token(SECRET), KEY, SECRET)).toBeNull();
  });

  it("flags a token signed with a different secret (e.g. rotated in Shopify, stale on the server)", () => {
    expect(diagnoseSessionToken(token("old-secret"), KEY, SECRET)).toEqual({ kind: "secret-mismatch", tokenClientId: KEY });
  });

  it("flags a token issued for a different app", () => {
    expect(diagnoseSessionToken(token(SECRET, { aud: "other-client-id" }), KEY, SECRET)).toEqual({ kind: "client-id-mismatch", tokenClientId: "other-client-id" });
  });

  it("leaves expired tokens to the library (its bounce-and-refresh is correct for those)", () => {
    expect(diagnoseSessionToken(token(SECRET, { exp: 1, nbf: 0, iat: 0 }), KEY, SECRET)).toBeNull();
  });

  it("leaves malformed tokens and missing config to other checks", () => {
    expect(diagnoseSessionToken("not-a-jwt", KEY, SECRET)).toBeNull();
    expect(diagnoseSessionToken(token("x"), undefined, SECRET)).toBeNull();
    expect(diagnoseSessionToken(token("x"), KEY, undefined)).toBeNull();
  });

  it("explains the fix without revealing the secret", () => {
    const d = describeProblem({ kind: "secret-mismatch", tokenClientId: KEY }, KEY);
    expect(JSON.stringify(d)).not.toContain(SECRET);
    expect(d.fix).toMatch(/SHOPIFY_API_SECRET/);
  });
});

describe("sessionTokenFromRequest", () => {
  it("reads the Bearer header (data requests) and the id_token param (page loads)", () => {
    expect(sessionTokenFromRequest(new Request("https://a.test/app", { headers: { Authorization: "Bearer abc" } }))).toEqual({ token: "abc", isDocumentRequest: false });
    expect(sessionTokenFromRequest(new Request("https://a.test/app?id_token=xyz"))).toEqual({ token: "xyz", isDocumentRequest: true });
    expect(sessionTokenFromRequest(new Request("https://a.test/app"))).toBeNull();
  });
});
