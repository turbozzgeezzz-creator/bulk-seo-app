import { describe, expect, it, vi } from "vitest";
import { fetchImageForVision, sniffMediaType, withCdnWidth } from "../app/lib/seo/imageFetch.server";
import { JPEG_BYTES } from "./helpers";

const noSleep = vi.fn(async () => {});
const ok = (bytes: Uint8Array, type = "image/jpeg") => new Response(bytes as BodyInit, { status: 200, headers: { "content-type": type } });

describe("withCdnWidth", () => {
  it("adds a bounded width to Shopify CDN URLs", () => {
    expect(withCdnWidth("https://cdn.shopify.com/s/files/1/0001/files/a.jpg?v=123", 1568)).toBe(
      "https://cdn.shopify.com/s/files/1/0001/files/a.jpg?v=123&width=1568",
    );
    expect(withCdnWidth("https://shop.myshopify.com/cdn/shop/files/a.jpg", 800)).toBe("https://shop.myshopify.com/cdn/shop/files/a.jpg?width=800");
  });
  it("leaves other hosts and already-sized URLs alone", () => {
    expect(withCdnWidth("https://example.com/a.jpg", 800)).toBe("https://example.com/a.jpg");
    expect(withCdnWidth("https://cdn.shopify.com/a.jpg?width=300", 800)).toBe("https://cdn.shopify.com/a.jpg?width=300");
  });
});

describe("fetchImageForVision", () => {
  it("returns base64 bytes and the sniffed type (not the header's)", async () => {
    const fetchImpl = vi.fn(async () => ok(JPEG_BYTES, "application/octet-stream"));
    const r = await fetchImageForVision("https://cdn.shopify.com/a.jpg", { fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ ok: true, mediaType: "image/jpeg", attempts: 1 });
  });

  it("retries 503 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(ok(JPEG_BYTES));
    const r = await fetchImageForVision("https://cdn.shopify.com/a.jpg", { fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
  });

  it("honours Retry-After on 429", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(ok(JPEG_BYTES));
    await fetchImageForVision("https://cdn.shopify.com/a.jpg", { fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("retries timeouts and reports a specific retryable reason when they persist", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const fetchImpl = vi.fn(async () => {
      throw timeout;
    });
    const r = await fetchImageForVision("https://cdn.shopify.com/a.jpg", { fetchImpl, sleep: noSleep, maxAttempts: 3, timeoutMs: 5000 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ ok: false, retryable: true });
    if (!r.ok) expect(r.reason).toMatch(/timed out after 5s/);
  });

  it("does not retry a 404 and says the image may be deleted", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const r = await fetchImageForVision("https://cdn.shopify.com/a.jpg", { fetchImpl, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, retryable: false });
    if (!r.ok) expect(r.reason).toMatch(/deleted/);
  });

  it("rejects AVIF with an actionable message", async () => {
    const avif = new Uint8Array([0, 0, 0, 0x1c, ...new TextEncoder().encode("ftypavif"), 0, 0]);
    const r = await fetchImageForVision("https://cdn.shopify.com/a.avif", { fetchImpl: async () => ok(avif, "image/avif"), sleep: noSleep });
    expect(r).toMatchObject({ ok: false, retryable: false });
    if (!r.ok) expect(r.reason).toMatch(/AVIF/);
  });

  it("rejects an HTML error page served with 200", async () => {
    const html = new TextEncoder().encode("<html>oops</html>");
    const r = await fetchImageForVision("https://cdn.shopify.com/a.jpg", { fetchImpl: async () => ok(html, "text/html"), sleep: noSleep });
    expect(r).toMatchObject({ ok: false, retryable: false });
  });

  it("rejects oversized images without downloading when Content-Length says so", async () => {
    const fetchImpl = vi.fn(async () => new Response(JPEG_BYTES as BodyInit, { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } }));
    const r = await fetchImageForVision("https://cdn.shopify.com/a.jpg", { fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ ok: false, retryable: false });
  });

  it("rejects non-https URLs", async () => {
    const r = await fetchImageForVision("http://cdn.shopify.com/a.jpg", { sleep: noSleep });
    expect(r.ok).toBe(false);
  });
});

describe("sniffMediaType", () => {
  it("detects png, gif and webp", () => {
    expect(sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMediaType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffMediaType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
});
