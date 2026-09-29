import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationError } from "../app/lib/ai/claude.server";
import type { ProcessorDeps } from "../app/lib/jobs/processors.server";
import { MAX_ITEM_ATTEMPTS, cancelJob, createJob, retryFailedItems, runJobChunk } from "../app/lib/jobs/runner.server";
import { fakeStore, type FakeProduct } from "./helpers";

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  await prisma.$executeRawUnsafe('TRUNCATE "BulkJobItem", "BulkJob", "Shop", "Session" CASCADE');
});
afterEach(async () => {
  await prisma.$disconnect();
});

const SHOP = "test-shop.myshopify.com";

function makeCatalog(productCount: number, imagesPer: number, withAltEvery = 0): FakeProduct[] {
  return Array.from({ length: productCount }, (_, p) => ({
    id: `gid://shopify/Product/${p + 1}`,
    title: `Product ${p + 1}`,
    seo: { title: null, description: null },
    media: Array.from({ length: imagesPer }, (_, i) => {
      const n = p * imagesPer + i + 1;
      return { id: `gid://shopify/MediaImage/${n}`, alt: withAltEvery && n % withAltEvery === 0 ? "Merchant alt text already here" : null, url: `https://cdn.shopify.com/${n}.jpg` };
    }),
  }));
}

function depsFor(store: ReturnType<typeof fakeStore>, overrides: Partial<ProcessorDeps> = {}): ProcessorDeps {
  return {
    graphql: store.graphql,
    fetchImage: async (url) => ({ ok: true, data: Buffer.from(url).toString("base64"), mediaType: "image/jpeg", bytes: 10, attempts: 1 }),
    generateAltText: async (image) => ({ altText: `Detailed photo of item ${Buffer.from(image.data, "base64").toString().match(/(\d+)\.jpg/)![1]} on a white background`, mismatchNote: null }),
    generateMeta: async (p) => ({
      metaTitle: `${p.title} | Breathable Linen Summer Wear`,
      metaDescription: `${p.title} in breathable linen with a relaxed fit, made for warm days. Pairs with chinos or shorts and comes in several sizes.`,
    }),
    ...overrides,
  };
}

async function runToEnd(jobId: string, getDeps: () => Promise<ProcessorDeps>, maxChunks = 50) {
  const snapshots: { status: string; processed: number; total: number }[] = [];
  for (let i = 0; i < maxChunks; i++) {
    await runJobChunk(jobId, { prisma, getDeps, timeBudgetMs: 60_000, concurrency: 3 });
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    snapshots.push({ status: job.status, processed: job.processed, total: job.total });
    if (!["SCANNING", "RUNNING"].includes(job.status)) break;
  }
  return snapshots;
}

describe("bulk alt-text job", () => {
  it("scans the whole catalog (including products with >50 images), fills only missing alt text, and verifies every write", async () => {
    const products = makeCatalog(7, 3, 4); // 21 images, 5 already have alt text
    products[0].media.push(
      ...Array.from({ length: 55 }, (_, i) => ({ id: `gid://shopify/MediaImage/big${i}`, alt: null, url: `https://cdn.shopify.com/9${i}.jpg` })),
    );
    const store = fakeStore(products, { pageSize: 3 });
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };

    await runToEnd(jobId, async () => depsFor(store));

    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "COMPLETED", scanned: 76, total: 71, processed: 71, succeeded: 71, failed: 0, scanComplete: true });
    const allAlt = products.flatMap((p) => p.media.map((m) => m.alt));
    expect(allAlt.every((a) => a && a.trim().length > 0)).toBe(true);
    expect(allAlt.filter((a) => a === "Merchant alt text already here")).toHaveLength(5);
  });

  it("progress is monotonic and exact while running", async () => {
    const store = fakeStore(makeCatalog(10, 2), { pageSize: 4 });
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    const snaps: number[] = [];
    for (let i = 0; i < 30; i++) {
      await runJobChunk(jobId, { prisma, getDeps: async () => depsFor(store), timeBudgetMs: 1, concurrency: 3 });
      const j = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
      snaps.push(j.processed);
      const items = await prisma.bulkJobItem.count({ where: { jobId, status: { not: "PENDING" } } });
      expect(j.processed).toBe(items);
      if (j.status === "COMPLETED") break;
    }
    expect(snaps).toEqual([...snaps].sort((a, b) => a - b));
    expect(snaps.at(-1)).toBe(20);
    expect(snaps.length).toBeGreaterThan(2);
  });

  it("fails blank AI output per item with a reason, and finishes as COMPLETED_WITH_ERRORS", async () => {
    const products = makeCatalog(3, 1);
    const store = fakeStore(products);
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    const deps = depsFor(store);
    const generateAltText: ProcessorDeps["generateAltText"] = async (image, p) =>
      p.title === "Product 2" ? { altText: "", mismatchNote: null } : deps.generateAltText(image, p);
    await runToEnd(jobId, async () => ({ ...deps, generateAltText }));

    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "COMPLETED_WITH_ERRORS", succeeded: 2, failed: 1, processed: 3 });
    const failed = await prisma.bulkJobItem.findFirstOrThrow({ where: { jobId, status: "FAILED" } });
    expect(failed.error).toMatch(/blank/);
    expect(products[1].media[0].alt).toBeNull();
  });

  it("retries transient failures, then fails them with the reason after the attempt limit", async () => {
    const store = fakeStore(makeCatalog(2, 1));
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    let calls = 0;
    const fetchImage: ProcessorDeps["fetchImage"] = async (url) => {
      if (url.includes("/1.jpg")) {
        calls++;
        return calls === 1 ? { ok: false, reason: "timed out after 15s", retryable: true, attempts: 4 } : depsFor(store).fetchImage(url);
      }
      return { ok: false, reason: "Could not download the image after 4 attempts: timed out after 15s.", retryable: true, attempts: 4 };
    };
    await runToEnd(jobId, async () => ({ ...depsFor(store), fetchImage }));
    const items = await prisma.bulkJobItem.findMany({ where: { jobId }, orderBy: { mediaId: "asc" } });
    expect(items[0]).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect(items[1]).toMatchObject({ status: "FAILED", attempts: MAX_ITEM_ATTEMPTS });
    expect(items[1].error).toMatch(/gave up after 3 attempts/);
  });

  it("stops the whole job on a fatal configuration error instead of failing every item", async () => {
    const store = fakeStore(makeCatalog(5, 2));
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    await runToEnd(jobId, async () => ({
      ...depsFor(store),
      generateAltText: async () => {
        throw new GenerationError("The AI service rejected the app's API credentials.", "fatal");
      },
    }));
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toMatch(/API credentials/);
    expect(job.failed).toBe(0);
    expect(await prisma.bulkJobItem.count({ where: { jobId, status: "PENDING" } })).toBe(10);
  });

  it("stops the job with one readable reason when Shopify revokes access mid-job, instead of failing every item", async () => {
    const store = fakeStore(makeCatalog(4, 3));
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    // The catalog scan works; every later call gets the library's 401 error.
    const graphql: ProcessorDeps["graphql"] = async (query, options) => {
      if (query.includes("BulkFlowScanProducts")) return store.graphql(query, options);
      throw new Error('Received an error response (401 Unauthorized) from Shopify: { "networkStatusCode": 401, "message": "GraphQL Client: Unauthorized" }');
    };
    await runToEnd(jobId, async () => depsFor(store, { graphql }));
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toMatch(/refused BulkFlow's access to this store \(HTTP 401\)/);
    expect(job.error).not.toMatch(/networkStatusCode/);
    expect(job.failed).toBe(0);
    expect(await prisma.bulkJobItem.count({ where: { jobId, status: "PENDING" } })).toBe(12);
  });

  it("fails the job with a clear reason when the store can't be reached", async () => {
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    await runJobChunk(jobId, { prisma, getDeps: async () => { throw new Error("Could not find a session for shop"); } });
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toMatch(/no longer has access/);
  });

  it("only one worker processes a job at a time", async () => {
    const store = fakeStore(makeCatalog(4, 1));
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    const getDeps = vi.fn(async () => depsFor(store));
    const claimed = await Promise.all([1, 2, 3].map(() => runJobChunk(jobId, { prisma, getDeps, timeBudgetMs: 60_000 })));
    expect(getDeps).toHaveBeenCalledTimes(1);
    // Only the claim holder reports doing work, so only it schedules the next chunk.
    expect(claimed.filter(Boolean)).toHaveLength(1);
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "COMPLETED", processed: 4, succeeded: 4 });
  });

  it("cancel stops processing; retry-failed re-runs just the failed items", async () => {
    const products = makeCatalog(3, 1);
    const store = fakeStore(products);
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    const deps = depsFor(store);
    let broken = true;
    const generateAltText: ProcessorDeps["generateAltText"] = async (image, p) =>
      broken && p.title === "Product 3" ? { altText: "Image", mismatchNote: null } : deps.generateAltText(image, p);
    await runToEnd(jobId, async () => ({ ...deps, generateAltText }));
    expect((await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } })).failed).toBe(1);

    broken = false;
    const retry = await retryFailedItems(prisma, SHOP, jobId);
    expect(retry.ok).toBe(true);
    const retryId = (retry as { jobId: string }).jobId;
    await runToEnd(retryId, async () => ({ ...deps, generateAltText }));
    expect(await prisma.bulkJob.findUniqueOrThrow({ where: { id: retryId } })).toMatchObject({ status: "COMPLETED", total: 1, succeeded: 1 });
    expect(products[2].media[0].alt).toMatch(/Detailed photo/);

    const { jobId: third } = (await createJob(prisma, SHOP, "META", "ONLY_MISSING")) as { ok: true; jobId: string };
    expect(await cancelJob(prisma, SHOP, third)).toBe(true);
    await runJobChunk(third, { prisma, getDeps: async () => deps });
    expect(await prisma.bulkJob.findUniqueOrThrow({ where: { id: third } })).toMatchObject({ status: "CANCELLED", processed: 0 });
  });

  it("refuses a second concurrent job of the same type for the same shop, but isolates shops", async () => {
    const a = await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING");
    const b = await createJob(prisma, SHOP, "ALT_TEXT", "OVERWRITE_ALL");
    const c = await createJob(prisma, "other-shop.myshopify.com", "ALT_TEXT", "ONLY_MISSING");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(c.ok).toBe(true);
    expect(await cancelJob(prisma, "other-shop.myshopify.com", (a as { jobId: string }).jobId)).toBe(false);
  });
});

describe("bulk meta job", () => {
  it("fills missing meta tags across the catalog", async () => {
    const products = makeCatalog(5, 0);
    products[1].seo = { title: "Merchant title", description: "Merchant description" };
    const store = fakeStore(products);
    const { jobId } = (await createJob(prisma, SHOP, "META", "ONLY_MISSING")) as { ok: true; jobId: string };
    await runToEnd(jobId, async () => depsFor(store));
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: "COMPLETED", scanned: 5, total: 4, succeeded: 4 });
    expect(products[1].seo.title).toBe("Merchant title");
    expect(products[0].seo.title).toBe("Product 1 | Breathable Linen Summer Wear");
  });
});
