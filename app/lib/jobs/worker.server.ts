import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { fetchImageForVision } from "../seo/imageFetch.server";
import { generateAltText, generateMeta } from "../seo/generate.server";
import type { ProcessorDeps } from "./processors.server";
import { ACTIVE_STATUSES, runJobChunk } from "./runner.server";

const TICK_MS = 2_000;
const MAX_JOBS_PER_TICK = 3;

export async function depsForShop(shop: string): Promise<ProcessorDeps> {
  // Uses the shop's offline access token (stored at install), so jobs keep
  // running after the merchant closes the admin tab.
  const { admin } = await unauthenticated.admin(shop);
  return {
    graphql: admin.graphql,
    fetchImage: (url) => fetchImageForVision(url),
    generateAltText: (image, product) => generateAltText(image, product),
    generateMeta: (product) => generateMeta(product),
  };
}

const inFlight = new Set<string>();

export function kickJob(jobId: string) {
  if (inFlight.has(jobId)) return;
  inFlight.add(jobId);
  runJobChunk(jobId, { prisma, getDeps: depsForShop })
    .catch((err) => console.error(`[jobs] chunk for ${jobId} crashed:`, err))
    .finally(() => inFlight.delete(jobId));
}

async function tick() {
  const now = new Date();
  const jobs = await prisma.bulkJob.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] }, OR: [{ claimedUntil: null }, { claimedUntil: { lt: now } }] },
    orderBy: { createdAt: "asc" },
    take: MAX_JOBS_PER_TICK,
    select: { id: true },
  });
  for (const job of jobs) kickJob(job.id);
}

declare global {
  // eslint-disable-next-line no-var
  var bulkFlowWorkerStarted: boolean | undefined;
}

/** Starts the in-process job ticker once per process (survives dev hot reloads). */
export function ensureWorkerStarted() {
  if (global.bulkFlowWorkerStarted || process.env.DISABLE_JOB_WORKER === "1") return;
  global.bulkFlowWorkerStarted = true;
  setInterval(() => {
    tick().catch((err) => console.error("[jobs] worker tick failed:", err));
  }, TICK_MS).unref();
}
