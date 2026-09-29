import { describe, expect, it, vi } from "vitest";
import { libraryLogFunction, signDiag, verifyDiag, withLibraryLogCapture } from "../app/lib/shopify/authTrace.server";

const SECRET = "s3cret";
const SHOP = "bulkflow-cwopi3ze.myshopify.com";

describe("diag signatures", () => {
  const now = 1_790_000_000_000;
  const ts = now / 1000;
  it("accepts a fresh signature made with the secret", () => {
    expect(verifyDiag(SHOP, ts, signDiag(SHOP, ts, SECRET), SECRET, now)).toBe(true);
  });
  it("rejects another secret, another shop, stale timestamps, junk and a missing secret", () => {
    expect(verifyDiag(SHOP, ts, signDiag(SHOP, ts, "other"), SECRET, now)).toBe(false);
    expect(verifyDiag("other.myshopify.com", ts, signDiag(SHOP, ts, SECRET), SECRET, now)).toBe(false);
    expect(verifyDiag(SHOP, ts - 301, signDiag(SHOP, ts - 301, SECRET), SECRET, now)).toBe(false);
    expect(verifyDiag(SHOP, ts, "zz", SECRET, now)).toBe(false);
    expect(verifyDiag(SHOP, ts, signDiag(SHOP, ts, SECRET), undefined, now)).toBe(false);
  });
});

describe("library log capture", () => {
  it("keeps every line for the current request but prints only up to the level", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fn = libraryLogFunction(2);
    const lines = await withLibraryLogCapture(async (captured) => {
      fn(3, "[shopify-app/DEBUG] why");
      await Promise.resolve();
      fn(2, "[shopify-app/INFO] what");
      return captured;
    });
    expect(lines).toEqual(["[shopify-app/DEBUG] why", "[shopify-app/INFO] what"]);
    expect(log).toHaveBeenCalledTimes(1);
    fn(2, "outside any request");
    expect(lines).toHaveLength(2);
    log.mockRestore();
  });

  it("never keeps a session token", async () => {
    const lines = await withLibraryLogCapture(async (captured) => {
      libraryLogFunction(-1)(3, '[shopify-app/DEBUG] Attempting to authenticate | {sessionToken: {"search":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123"}}');
      return captured;
    });
    expect(lines[0]).toBe('[shopify-app/DEBUG] Attempting to authenticate | {sessionToken: {"search":"<session token>"}}');
  });
});
