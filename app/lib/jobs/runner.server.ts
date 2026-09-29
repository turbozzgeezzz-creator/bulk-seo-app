import type { PrismaClient } from "@prisma/client";
import { scanProductsPage, type ScannedProduct } from "../shopify/products.server";
import { processAltTextItem, processMetaItem, type ItemOutcome, type JobMode, type ProcessorDeps } from "./processors.server";
import { ensureShop, refundUnit, reserveUnit, rolloverIfDue, usageFor, type Unit } from "../billing/usage.server";

/**
 * Bulk job runner.
 *
 * Carried over from Luxe+'s altTextBatch.ts (the parts that were learned the
 * hard way there), generalised to any job type and any shop:
 *  - Work is done in bounded chunks with a short-lived claim (`claimedUntil`),
 *    never one unbounded loop and never a DB transaction held open across
 *    slow AI calls. A crashed chunk's claim simply expires and the next tick
 *    resumes where it stopped.
 *  - All progress lives in the database (per-item status + job counters), so
 *    the progress bar is real: "142 of 500" is 142 items with a final status.
 *  - Transient failures (rate limits, CDN timeouts) leave the item pending for
 *    a later attempt, up to MAX_ITEM_ATTEMPTS, then fail it with the reason.
 *  - A configuration failure that would fail every item (bad AI key, lost
 *    store access) stops the job with that reason instead of burning through
 *    the catalog marking thousands of items failed.
 *
 * Unlike Luxe+ (serverless on Vercel, which needed self-triggered HTTP
 * continuations), this app runs as a long-lived Node server, so an in-process
 * ticker drives the chunks. The claim makes it safe to run several instances.
 */

export const MAX_ITEM_ATTEMPTS = 3;
const SCAN_PAGES_PER_CHUNK = 5;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const DEFAULT_CONCURRENCY = 4;
const CLAIM_GRACE_MS = 60_000;

export const ACTIVE_STATUSES = ["SCANNING", "RUNNING"] as const;
/** Not being worked on, but not finished: waiting for plan allowance or credits. */
export const PAUSED = "PAUSED";

export interface RunnerOptions {
  prisma: PrismaClient;
  /** Builds the Shopify/AI dependencies for a shop. Throws if the app has lost access to the shop. */
  getDeps: (shop: string) => Promise<ProcessorDeps>;
  timeBudgetMs?: number;
  concurrency?: number;
  /** Pause jobs when the shop's plan allowance and credits run out (BILLING_ENABLED). Usage is counted either way. */
  enforceLimits?: boolean;
}

function itemsForProduct(jobType: string, mode: JobMode, p: ScannedProduct) {
  if (jobType === "ALT_TEXT") {
    const images = p.media;
    const items = images
      .map((m, i) => ({
        productId: p.id,
        mediaId: m.id,
        label: images.length > 1 ? `${p.title} (image ${i + 1} of ${images.length})` : p.title,
        imageUrl: m.url,
        alt: m.alt,
      }))
      .filter((m) => mode === "OVERWRITE_ALL" || !m.alt?.trim());
    return { scanned: images.length, items };
  }
  const missing = !p.seoTitle?.trim() || !p.seoDescription?.trim();
  return {
    scanned: 1,
    items: mode === "OVERWRITE_ALL" || missing ? [{ productId: p.id, mediaId: "", label: p.title, imageUrl: null }] : [],
  };
}

async function scanSome(prisma: PrismaClient, job: { id: string; shop: string; type: string; mode: string; scanCursor: string | null }, deps: ProcessorDeps, deadline: number) {
  let cursor = job.scanCursor;
  for (let page = 0; page < SCAN_PAGES_PER_CHUNK && Date.now() < deadline; page++) {
    const { products, nextCursor } = await scanProductsPage(deps.graphql, cursor);
    let scanned = 0;
    const rows: { jobId: string; shop: string; productId: string; mediaId: string; label: string; imageUrl: string | null }[] = [];
    for (const p of products) {
      const r = itemsForProduct(job.type, job.mode as JobMode, p);
      scanned += r.scanned;
      for (const it of r.items) {
        rows.push({ jobId: job.id, shop: job.shop, productId: it.productId, mediaId: it.mediaId, label: it.label.slice(0, 300), imageUrl: it.imageUrl });
      }
    }
    // Items and the cursor advance together, so a crash can't double-insert a page.
    await prisma.$transaction([
      prisma.bulkJobItem.createMany({ data: rows }),
      prisma.bulkJob.update({
        where: { id: job.id },
        data: {
          scanCursor: nextCursor,
          scanComplete: nextCursor === null,
          scanned: { increment: scanned },
          total: { increment: rows.length },
          status: "RUNNING",
          startedAt: job.scanCursor === null && page === 0 ? new Date() : undefined,
        },
      }),
    ]);
    cursor = nextCursor;
    if (nextCursor === null) return true;
  }
  return false;
}

async function recordOutcome(prisma: PrismaClient, jobId: string, item: { id: string; attempts: number }, outcome: ItemOutcome) {
  const attempts = item.attempts + 1;
  if (outcome.status === "RETRY") {
    if (attempts < MAX_ITEM_ATTEMPTS) {
      await prisma.bulkJobItem.update({ where: { id: item.id }, data: { attempts, error: outcome.reason } });
      return;
    }
    outcome = { status: "FAILED", reason: `${outcome.reason} (gave up after ${MAX_ITEM_ATTEMPTS} attempts)` };
  }
  if (outcome.status === "FATAL") return; // handled by the caller: item stays pending, job stops.

  const counter = outcome.status === "SUCCEEDED" ? "succeeded" : outcome.status === "SKIPPED" ? "skipped" : "failed";
  await prisma.$transaction([
    prisma.bulkJobItem.update({
      where: { id: item.id },
      data: {
        status: outcome.status,
        attempts,
        error: outcome.status === "SUCCEEDED" ? null : outcome.reason,
        note: outcome.status === "SUCCEEDED" ? (outcome.note ?? null) : null,
        before: outcome.status === "SUCCEEDED" ? JSON.stringify(outcome.before) : undefined,
        after: outcome.status === "SUCCEEDED" ? JSON.stringify(outcome.after) : undefined,
      },
    }),
    prisma.bulkJob.update({ where: { id: jobId }, data: { processed: { increment: 1 }, [counter]: { increment: 1 } } }),
  ]);
}

async function finishIfDone(prisma: PrismaClient, jobId: string) {
  const job = await prisma.bulkJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING" || !job.scanComplete) return;
  const pending = await prisma.bulkJobItem.count({ where: { jobId, status: "PENDING" } });
  if (pending > 0) return;
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: { status: job.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED", finishedAt: new Date() },
  });
}

async function pauseJob(prisma: PrismaClient, jobId: string, shop: string) {
  const u = await usageFor(prisma, shop);
  const reset = u.periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  await prisma.bulkJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: PAUSED,
      error: `Your ${u.planLabel} plan's ${u.included.toLocaleString("en-US")} items for this period are used up and there are no credits left. Upgrade or buy credits and it continues automatically; otherwise it picks up again on ${reset}. Nothing was lost.`,
    },
  });
}

async function failJob(prisma: PrismaClient, jobId: string, reason: string) {
  await prisma.bulkJob.update({ where: { id: jobId }, data: { status: "FAILED", error: reason, finishedAt: new Date() } });
}

/**
 * Processes one bounded chunk of a job. Safe to call concurrently; only the
 * claim holder does work. Returns whether this call held the claim (so the
 * caller knows whether it's responsible for scheduling the next chunk).
 */
export async function runJobChunk(jobId: string, opts: RunnerOptions): Promise<boolean> {
  const { prisma } = opts;
  const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const now = new Date();

  const claim = await prisma.bulkJob.updateMany({
    where: { id: jobId, status: { in: [...ACTIVE_STATUSES] }, OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }] },
    data: { claimedUntil: new Date(now.getTime() + budget + CLAIM_GRACE_MS) },
  });
  if (claim.count === 0) return false;

  try {
    const job = await prisma.bulkJob.findUniqueOrThrow({ where: { id: jobId } });
    await ensureShop(prisma, job.shop);
    await rolloverIfDue(prisma, job.shop);
    const deadline = Date.now() + budget;

    let deps: ProcessorDeps;
    try {
      deps = await opts.getDeps(job.shop);
    } catch (err) {
      await failJob(prisma, jobId, `The app no longer has access to this store (${err instanceof Error ? err.message : String(err)}). Reinstall the app and run the job again.`);
      return true;
    }

    if (!job.scanComplete) {
      try {
        await scanSome(prisma, job, deps, deadline);
      } catch (err) {
        await failJob(prisma, jobId, `Could not read the product catalog from Shopify: ${err instanceof Error ? err.message : String(err)}`);
        return true;
      }
    }

    const mode = job.mode as JobMode;
    const processOne = (item: { productId: string; mediaId: string }) =>
      job.type === "ALT_TEXT" ? processAltTextItem(item, mode, deps) : processMetaItem(item, mode, deps);

    // Items that failed transiently are retried only after fresh items, so one
    // flaky image can't hold up the rest of the job.
    const retryIdsThisChunk = new Set<string>();
    while (Date.now() < deadline) {
      const current = await prisma.bulkJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!current || current.status !== "RUNNING") return true; // cancelled or finished elsewhere

      const batch = await prisma.bulkJobItem.findMany({
        where: { jobId, status: "PENDING", id: { notIn: [...retryIdsThisChunk] } },
        orderBy: [{ attempts: "asc" }, { createdAt: "asc" }],
        take: concurrency,
      });
      if (batch.length === 0) break;

      // One unit of the shop's allowance per item, reserved up front and given
      // back unless the item ends in a verified write.
      const units: (Unit | null)[] = [];
      for (let i = 0; i < batch.length; i++) units.push(await reserveUnit(prisma, job.shop, opts.enforceLimits ?? false));
      const runnable = batch.filter((_, i) => units[i] !== null);
      const outcomes = await Promise.all(runnable.map((item) => processOne(item)));
      const fatal = outcomes.find((o) => o.status === "FATAL");
      for (let i = 0; i < runnable.length; i++) {
        if (outcomes[i].status !== "SUCCEEDED") await refundUnit(prisma, job.shop, units[batch.indexOf(runnable[i])]!);
        if (outcomes[i].status === "RETRY") retryIdsThisChunk.add(runnable[i].id);
        await recordOutcome(prisma, jobId, runnable[i], outcomes[i]);
      }
      if (runnable.length < batch.length && !fatal) {
        await pauseJob(prisma, jobId, job.shop);
        return true;
      }
      if (fatal) {
        await failJob(prisma, jobId, `${fatal.reason} The job was stopped so the rest of your catalog wasn't marked as failed; nothing else was changed.`);
        return true;
      }
    }

    await finishIfDone(prisma, jobId);
    return true;
  } finally {
    await prisma.bulkJob.updateMany({ where: { id: jobId }, data: { claimedUntil: null } });
  }
}

/** Starts a job for a shop. Refuses if one of the same type is already running for that shop. */
export async function createJob(prisma: PrismaClient, shop: string, type: "ALT_TEXT" | "META", mode: JobMode) {
  const active = await prisma.bulkJob.findFirst({ where: { shop, type, status: { in: [...ACTIVE_STATUSES, PAUSED] } } });
  if (active) return { ok: false as const, error: "A job of this type is already running for your store.", jobId: active.id };
  const job = await prisma.bulkJob.create({ data: { shop, type, mode, status: "SCANNING" } });
  return { ok: true as const, jobId: job.id };
}

/** Re-queues the failed items of a finished job as a new job, so a merchant can retry just those. */
export async function retryFailedItems(prisma: PrismaClient, shop: string, jobId: string) {
  const job = await prisma.bulkJob.findFirst({ where: { id: jobId, shop } });
  if (!job) return { ok: false as const, error: "Job not found." };
  const failed = await prisma.bulkJobItem.findMany({ where: { jobId, status: "FAILED" } });
  if (failed.length === 0) return { ok: false as const, error: "This job has no failed items to retry." };
  const active = await prisma.bulkJob.findFirst({ where: { shop, type: job.type, status: { in: [...ACTIVE_STATUSES, PAUSED] } } });
  if (active) return { ok: false as const, error: "A job of this type is already running for your store.", jobId: active.id };
  const retry = await prisma.bulkJob.create({
    data: {
      shop,
      type: job.type,
      mode: job.mode,
      status: "RUNNING",
      scanComplete: true,
      scanned: failed.length,
      total: failed.length,
      startedAt: new Date(),
      items: {
        create: failed.map((f) => ({ shop, productId: f.productId, mediaId: f.mediaId, label: f.label, imageUrl: f.imageUrl })),
      },
    },
  });
  return { ok: true as const, jobId: retry.id };
}

export async function cancelJob(prisma: PrismaClient, shop: string, jobId: string) {
  const res = await prisma.bulkJob.updateMany({
    where: { id: jobId, shop, status: { in: [...ACTIVE_STATUSES, PAUSED] } },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
  return res.count > 0;
}
