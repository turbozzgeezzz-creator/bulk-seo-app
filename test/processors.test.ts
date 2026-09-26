import { describe, expect, it, vi } from "vitest";
import { GenerationError } from "../app/lib/ai/claude.server";
import { processAltTextItem, processMetaItem, type ProcessorDeps } from "../app/lib/jobs/processors.server";
import { fakeStore, type FakeProduct } from "./helpers";

function catalog(): FakeProduct[] {
  return [
    {
      id: "gid://shopify/Product/1",
      title: "Linen Shirt",
      seo: { title: null, description: null },
      media: [
        { id: "gid://shopify/MediaImage/11", alt: null, url: "https://cdn.shopify.com/11.jpg" },
        { id: "gid://shopify/MediaImage/12", alt: "Existing alt text written by the merchant", url: "https://cdn.shopify.com/12.jpg" },
      ],
    },
  ];
}

const item = { productId: "gid://shopify/Product/1", mediaId: "gid://shopify/MediaImage/11" };

function deps(store: ReturnType<typeof fakeStore>, overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    graphql: store.graphql,
    fetchImage: vi.fn(async () => ({ ok: true as const, data: "AAAA", mediaType: "image/jpeg" as const, bytes: 3, attempts: 1 })),
    generateAltText: vi.fn(async () => ({ altText: "Blue linen shirt with a chest pocket on a wooden hanger", mismatchNote: null })),
    generateMeta: vi.fn(async () => ({
      metaTitle: "Linen Shirt | Breathable Relaxed-Fit Summer Shirt",
      metaDescription: "A breathable relaxed-fit linen shirt with a chest pocket, made for warm days. Pairs with chinos or shorts; available in several sizes.",
    })),
    ...overrides,
  };
}

describe("processAltTextItem", () => {
  it("writes, reads back, and only then reports success", async () => {
    const products = catalog();
    const store = fakeStore(products);
    const r = await processAltTextItem(item, "ONLY_MISSING", deps(store));
    expect(r).toMatchObject({ status: "SUCCEEDED", before: "", after: "Blue linen shirt with a chest pocket on a wooden hanger" });
    expect(products[0].media[0].alt).toBe("Blue linen shirt with a chest pocket on a wooden hanger");
    expect(store.calls.map((c) => c.op)).toEqual(["BulkFlowAltItem", "BulkFlowSetAlt", "BulkFlowReadAlt"]);
  });

  it("never writes blank alt text: the item fails with a reason and Shopify is not called", async () => {
    const products = catalog();
    const store = fakeStore(products);
    const r = await processAltTextItem(item, "ONLY_MISSING", deps(store, { generateAltText: vi.fn(async () => ({ altText: "   ", mismatchNote: null })) }));
    expect(r.status).toBe("FAILED");
    if (r.status === "FAILED") expect(r.reason).toMatch(/blank/);
    expect(store.calls.some((c) => c.op === "BulkFlowSetAlt")).toBe(false);
    expect(products[0].media[0].alt).toBeNull();
  });

  it("reports a write Shopify acknowledged but didn't persist as a retry, not a success", async () => {
    const store = fakeStore(catalog(), { dropWritesFor: new Set([item.mediaId]) });
    const r = await processAltTextItem(item, "ONLY_MISSING", deps(store));
    expect(r.status).toBe("RETRY");
    if (r.status === "RETRY") expect(r.reason).toMatch(/reads back as blank/);
  });

  it("surfaces Shopify userErrors as a failure", async () => {
    const store = fakeStore(catalog(), { altUserErrorFor: new Set([item.mediaId]) });
    const r = await processAltTextItem(item, "ONLY_MISSING", deps(store));
    expect(r).toMatchObject({ status: "FAILED" });
    if (r.status === "FAILED") expect(r.reason).toMatch(/Alt is invalid/);
  });

  it("skips images that already have alt text in ONLY_MISSING mode without calling the AI", async () => {
    const store = fakeStore(catalog());
    const d = deps(store);
    const r = await processAltTextItem({ ...item, mediaId: "gid://shopify/MediaImage/12" }, "ONLY_MISSING", d);
    expect(r).toMatchObject({ status: "SKIPPED" });
    expect(d.generateAltText).not.toHaveBeenCalled();
  });

  it("passes through the image fetch's specific failure reason", async () => {
    const store = fakeStore(catalog());
    const r = await processAltTextItem(
      item,
      "ONLY_MISSING",
      deps(store, { fetchImage: vi.fn(async () => ({ ok: false as const, reason: "Could not download the image: the image host returned HTTP 404 (the image may have been deleted).", retryable: false, attempts: 1 })) }),
    );
    expect(r).toEqual({ status: "FAILED", reason: expect.stringMatching(/HTTP 404/) });
  });

  it("keeps a transient image fetch failure retryable", async () => {
    const store = fakeStore(catalog());
    const r = await processAltTextItem(
      item,
      "ONLY_MISSING",
      deps(store, { fetchImage: vi.fn(async () => ({ ok: false as const, reason: "timed out", retryable: true, attempts: 4 })) }),
    );
    expect(r.status).toBe("RETRY");
  });

  it("writes real alt text even when the photo looks mismatched, and returns the note", async () => {
    const store = fakeStore(catalog());
    const r = await processAltTextItem(
      item,
      "ONLY_MISSING",
      deps(store, { generateAltText: vi.fn(async () => ({ altText: "Grey plastic tackle box with a hinged lid", mismatchNote: "Shows a tackle box, not a shirt." })) }),
    );
    expect(r).toMatchObject({ status: "SUCCEEDED", after: "Grey plastic tackle box with a hinged lid", note: "Shows a tackle box, not a shirt." });
  });

  it("maps a fatal AI configuration error to FATAL", async () => {
    const store = fakeStore(catalog());
    const r = await processAltTextItem(
      item,
      "ONLY_MISSING",
      deps(store, { generateAltText: vi.fn(async () => { throw new GenerationError("bad key", "fatal"); }) }),
    );
    expect(r).toEqual({ status: "FATAL", reason: "bad key" });
  });

  it("skips an image deleted since the scan", async () => {
    const products = catalog();
    products[0].media.shift();
    const r = await processAltTextItem(item, "ONLY_MISSING", deps(fakeStore(products)));
    expect(r.status).toBe("SKIPPED");
  });
});

describe("processMetaItem", () => {
  it("fills both missing fields and verifies them", async () => {
    const products = catalog();
    const r = await processMetaItem({ productId: item.productId }, "ONLY_MISSING", deps(fakeStore(products)));
    expect(r.status).toBe("SUCCEEDED");
    expect(products[0].seo.title).toBe("Linen Shirt | Breathable Relaxed-Fit Summer Shirt");
  });

  it("only writes the missing field in ONLY_MISSING mode", async () => {
    const products = catalog();
    products[0].seo.title = "Merchant's own title";
    const store = fakeStore(products);
    await processMetaItem({ productId: item.productId }, "ONLY_MISSING", deps(store));
    const write = store.calls.find((c) => c.op === "BulkFlowSetSeo")!;
    expect((write.variables.product as { seo: object }).seo).not.toHaveProperty("title");
    expect(products[0].seo.title).toBe("Merchant's own title");
  });

  it("fails without writing if the AI returns a blank description", async () => {
    const products = catalog();
    const store = fakeStore(products);
    const r = await processMetaItem(
      { productId: item.productId },
      "ONLY_MISSING",
      deps(store, { generateMeta: vi.fn(async () => ({ metaTitle: "Linen Shirt | Breathable Summer Shirt", metaDescription: "" })) }),
    );
    expect(r.status).toBe("FAILED");
    expect(store.calls.some((c) => c.op === "BulkFlowSetSeo")).toBe(false);
  });

  it("does not report success when the write doesn't persist", async () => {
    const r = await processMetaItem({ productId: item.productId }, "ONLY_MISSING", deps(fakeStore(catalog(), { dropWritesFor: new Set([item.productId]) })));
    expect(r.status).toBe("RETRY");
  });
});
