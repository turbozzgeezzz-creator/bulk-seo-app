import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLANS } from "../app/lib/billing/plans";
import {
  applySubscriptionEvent,
  refundUnit,
  reserveUnit,
  resumePausedJobs,
  rolloverIfDue,
  syncCreditPurchases,
  syncPlan,
  usageFor,
} from "../app/lib/billing/usage.server";
import type { ProcessorDeps } from "../app/lib/jobs/processors.server";
import { createJob, runJobChunk } from "../app/lib/jobs/runner.server";
import { fakeStore } from "./helpers";

let prisma: PrismaClient;
const SHOP = "billing-test.myshopify.com";
const FREE = PLANS.FREE.includedItems;

beforeEach(async () => {
  prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  await prisma.$executeRawUnsafe('TRUNCATE "BulkJobItem", "BulkJob", "Shop", "CreditPurchase" CASCADE');
  await prisma.shop.create({ data: { shop: SHOP } });
});
afterEach(async () => {
  await prisma.$disconnect();
});

describe("usage metering", () => {
  it("uses included items first, then credits, then refuses when enforced", async () => {
    await prisma.shop.update({ where: { shop: SHOP }, data: { usedThisPeriod: FREE - 1, creditBalance: 1 } });
    expect(await reserveUnit(prisma, SHOP, true)).toBe("included");
    expect(await reserveUnit(prisma, SHOP, true)).toBe("credit");
    expect(await reserveUnit(prisma, SHOP, true)).toBeNull();
    const u = await usageFor(prisma, SHOP);
    expect(u).toMatchObject({ used: FREE, creditBalance: 0, creditsUsed: 1, remaining: 0 });
  });

  it("keeps counting but never blocks while billing is off", async () => {
    await prisma.shop.update({ where: { shop: SHOP }, data: { usedThisPeriod: FREE } });
    expect(await reserveUnit(prisma, SHOP, false)).toBe("included");
    expect((await usageFor(prisma, SHOP)).used).toBe(FREE + 1);
  });

  it("refunds to the bucket the unit came from", async () => {
    await prisma.shop.update({ where: { shop: SHOP }, data: { usedThisPeriod: FREE, creditBalance: 5 } });
    const unit = await reserveUnit(prisma, SHOP, true);
    expect(unit).toBe("credit");
    await refundUnit(prisma, SHOP, unit!);
    expect(await usageFor(prisma, SHOP)).toMatchObject({ used: FREE, creditBalance: 5, creditsUsed: 0 });
  });

  it("never overspends when many items reserve at once", async () => {
    await prisma.shop.update({ where: { shop: SHOP }, data: { usedThisPeriod: FREE - 3, creditBalance: 2 } });
    const results = await Promise.all(Array.from({ length: 25 }, () => reserveUnit(prisma, SHOP, true)));
    expect(results.filter((r) => r === "included")).toHaveLength(3);
    expect(results.filter((r) => r === "credit")).toHaveLength(2);
    expect(results.filter((r) => r === null)).toHaveLength(20);
    expect(await usageFor(prisma, SHOP)).toMatchObject({ used: FREE, creditBalance: 0 });
  });

  it("starts a fresh period after 30 days, keeping credits", async () => {
    const start = new Date("2026-08-01T00:00:00Z");
    await prisma.shop.update({ where: { shop: SHOP }, data: { periodStart: start, usedThisPeriod: FREE, creditsUsedThisPeriod: 4, creditBalance: 9 } });
    await rolloverIfDue(prisma, SHOP, new Date("2026-08-30T23:00:00Z"));
    expect((await usageFor(prisma, SHOP, new Date("2026-08-30T23:00:00Z"))).used).toBe(FREE);
    const u = await usageFor(prisma, SHOP, new Date("2026-08-31T00:00:01Z"));
    expect(u).toMatchObject({ used: 0, creditsUsed: 0, creditBalance: 9, remaining: FREE + 9 });
  });
});

describe("syncing from Shopify", () => {
  const pack = { id: "gid://shopify/AppPurchaseOneTime/1", name: "BulkFlow 250 credits", status: "ACTIVE", test: true };

  it("credits an approved credit pack exactly once, even when synced concurrently", async () => {
    const added = await Promise.all([1, 2, 3].map(() => syncCreditPurchases(prisma, SHOP, [pack])));
    expect(added.reduce((a, b) => a + b, 0)).toBe(250);
    expect(await syncCreditPurchases(prisma, SHOP, [pack])).toBe(0);
    expect((await usageFor(prisma, SHOP)).creditBalance).toBe(250);
    expect(await prisma.creditPurchase.count()).toBe(1);
  });

  it("ignores purchases that aren't approved yet, and unknown names", async () => {
    expect(await syncCreditPurchases(prisma, SHOP, [{ ...pack, status: "PENDING" }, { ...pack, id: "x", name: "Something else" }])).toBe(0);
  });

  it("sets the plan from the active subscription and falls back to Free", async () => {
    expect(await syncPlan(prisma, SHOP, [{ id: "gid://shopify/AppSubscription/7", name: "BulkFlow Growth", status: "ACTIVE" }])).toBe("GROWTH");
    expect((await usageFor(prisma, SHOP)).included).toBe(PLANS.GROWTH.includedItems);
    expect(await syncPlan(prisma, SHOP, [])).toBe("FREE");
  });

  it("webhook: an approval sets the plan; only the current subscription ending drops to Free", async () => {
    await applySubscriptionEvent(prisma, SHOP, { id: "sub-1", name: "BulkFlow Pro", status: "ACTIVE" });
    expect(await applySubscriptionEvent(prisma, SHOP, { id: "old-sub", name: "BulkFlow Starter", status: "CANCELLED" })).toBe("PRO");
    expect(await applySubscriptionEvent(prisma, SHOP, { id: "sub-1", name: "BulkFlow Pro", status: "CANCELLED" })).toBe("FREE");
  });
});

describe("jobs and plan limits", () => {
  const catalog = (n: number) =>
    Array.from({ length: n }, (_, p) => ({
      id: `gid://shopify/Product/${p + 1}`,
      title: `Product ${p + 1}`,
      seo: { title: null, description: null },
      media: [{ id: `gid://shopify/MediaImage/${p + 1}`, alt: null, url: `https://cdn.shopify.com/${p + 1}.jpg` }],
    }));
  const deps = (store: ReturnType<typeof fakeStore>, failEvery = 0): ProcessorDeps => ({
    graphql: store.graphql,
    fetchImage: async (url) => ({ ok: true, data: Buffer.from(url).toString("base64"), mediaType: "image/jpeg", bytes: 10, attempts: 1 }),
    generateAltText: async (image) => {
      const n = Number(Buffer.from(image.data, "base64").toString().match(/(\d+)\.jpg/)![1]);
      if (failEvery && n % failEvery === 0) return { altText: "", mismatchNote: null }; // rejected as blank -> FAILED
      return { altText: `Detailed studio photo of product number ${n} on white`, mismatchNote: null };
    },
    generateMeta: async () => ({ metaTitle: "x", metaDescription: "y" }),
  });

  it("pauses at the limit, counts only verified writes, and finishes after credits are added", async () => {
    await prisma.shop.update({ where: { shop: SHOP }, data: { usedThisPeriod: FREE - 4 } });
    const store = fakeStore(catalog(10));
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    const run = async () => {
      for (let i = 0; i < 20; i++) {
        await runJobChunk(jobId, { prisma, getDeps: async () => deps(store, 3), timeBudgetMs: 60_000, concurrency: 3, enforceLimits: true });
        const j = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
        if (j.status !== "RUNNING" && j.status !== "SCANNING") return j;
      }
      throw new Error("job never settled");
    };

    let job = await run();
    expect(job.status).toBe("PAUSED");
    expect(job.error).toMatch(/Your Free plan's 50 items for this period are used up/);
    expect(job.succeeded).toBe(4); // only the 4 remaining included items were spent on verified writes
    expect((await usageFor(prisma, SHOP)).used).toBe(FREE);

    await syncCreditPurchases(prisma, SHOP, [{ id: "p1", name: "BulkFlow 250 credits", status: "ACTIVE" }]);
    expect(await resumePausedJobs(prisma, SHOP)).toEqual([jobId]);
    job = await run();
    expect(job.status).toBe("COMPLETED_WITH_ERRORS");
    expect(job.succeeded + job.failed).toBe(10);
    const u = await usageFor(prisma, SHOP);
    // Items 3, 6 and 9 failed (blank AI output): they cost nothing.
    expect(job.failed).toBe(3);
    expect(u.creditsUsed).toBe(job.succeeded - 4);
    expect(u.creditBalance).toBe(250 - (job.succeeded - 4));
  });

  it("with billing off, never pauses (usage still counted)", async () => {
    await prisma.shop.update({ where: { shop: SHOP }, data: { usedThisPeriod: FREE } });
    const store = fakeStore(catalog(3));
    const { jobId } = (await createJob(prisma, SHOP, "ALT_TEXT", "ONLY_MISSING")) as { ok: true; jobId: string };
    await runJobChunk(jobId, { prisma, getDeps: async () => deps(store), timeBudgetMs: 60_000, concurrency: 3 });
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("COMPLETED");
    expect((await usageFor(prisma, SHOP)).used).toBe(FREE + 3);
  });
});
