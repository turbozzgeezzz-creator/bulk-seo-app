import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOUNCE_LIMIT, WINDOW_MS, diagnoseLoop, isBounceRedirect, recordBounce } from "../app/lib/shopify/authLoopGuard.server";

const KEY = "112d8cc57cd35b3baa6d4718b23c7f02";
const SECRET = "current-secret";
const SHOP = "bulkflow-cwopi3ze.myshopify.com";

function token(secret = SECRET, aud = KEY) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud, sub: "1", exp: now + 60, nbf: now, iat: now });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "AuthBounce"');
});
afterAll(() => prisma.$disconnect());

describe("isBounceRedirect", () => {
  it("recognises the library's redirect to the bounce page, and nothing else", () => {
    expect(isBounceRedirect(new Response(null, { status: 302, headers: { Location: "/auth/session-token?shop=x" } }))).toBe(true);
    expect(isBounceRedirect(new Response(null, { status: 302, headers: { Location: "/auth/login" } }))).toBe(false);
    expect(isBounceRedirect(new Response("x", { status: 500 }))).toBe(false);
    expect(isBounceRedirect(new Error("x"))).toBe(false);
  });
});

describe("recordBounce", () => {
  it("counts bounces per shop within the window, then starts over", async () => {
    const t0 = new Date("2026-09-29T10:00:00Z");
    for (let i = 1; i <= BOUNCE_LIMIT + 1; i++) expect(await recordBounce(prisma, SHOP, new Date(t0.getTime() + i * 1000))).toBe(i);
    expect(await recordBounce(prisma, "other.myshopify.com", t0)).toBe(1);
    expect(await recordBounce(prisma, SHOP, new Date(t0.getTime() + WINDOW_MS + 60_000))).toBe(1);
  });
});

describe("diagnoseLoop", () => {
  const base = { shop: SHOP, apiKey: KEY, apiSecret: SECRET };

  it("no token ever arrives: points at the Client ID", async () => {
    const d = await diagnoseLoop({ ...base, sessionToken: null });
    expect(d.title).toMatch(/never handed/);
    expect(d.fix).toContain(KEY);
  });

  it("secret mismatch is reported without calling Shopify", async () => {
    const f = vi.fn();
    const d = await diagnoseLoop({ ...base, sessionToken: token("old-secret") }, f as unknown as typeof fetch);
    expect(d.title).toMatch(/Client Secret/);
    expect(f).not.toHaveBeenCalled();
  });

  it("valid token but Shopify rejects the exchange: shows Shopify's own words", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_subject_token", error_description: "The app is not installed on this shop" }), { status: 400 }),
    );
    const d = await diagnoseLoop({ ...base, sessionToken: token() }, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith(`https://${SHOP}/admin/oauth/access_token`, expect.objectContaining({ method: "POST" }));
    expect(d.title).toMatch(/refuses/);
    expect(d.detail).toContain("invalid_subject_token: The app is not installed on this shop");
    expect(d.fix).toMatch(/scopes/);
  });

  it("invalid_client points at the credentials", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    const d = await diagnoseLoop({ ...base, sessionToken: token() }, f as unknown as typeof fetch);
    expect(d.fix).toMatch(/Client ID \/ Client Secret/);
  });

  it("network failure is reported as such", async () => {
    const f = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const d = await diagnoseLoop({ ...base, sessionToken: token() }, f as unknown as typeof fetch);
    expect(d.detail).toMatch(/ENOTFOUND/);
  });

  it("never puts the client secret in the message", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_subject_token" }), { status: 400 }));
    for (const sessionToken of [null, token("wrong"), token()]) {
      const d = await diagnoseLoop({ ...base, sessionToken }, f as unknown as typeof fetch);
      expect(JSON.stringify(d)).not.toContain(SECRET);
    }
  });
});
