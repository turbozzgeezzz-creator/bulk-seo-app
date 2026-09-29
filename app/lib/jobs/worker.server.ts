import { createHmac, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import prisma from "../../db.server";
import { resolveAppUrl } from "../../config.server";
import { unauthenticated } from "../../shopify.server";
import { fetchImageForVision } from "../seo/imageFetch.server";
import { generateAltText, generateMeta } from "../seo/generate.server";
import type { ProcessorDeps } from "./processors.server";
import { ACTIVE_STATUSES, runJobChunk } from "./runner.server";
import { BILLING_ENABLED } from "../../billing.server";
import { resumePausedJobs } from "../billing/usage.server";

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

/**
 * How jobs keep moving, by platform:
 *
 *  - Long-lived Node server (`npm start`, `npm run dev`): an in-process ticker
 *    (ensureWorkerStarted) picks up any active job every couple of seconds.
 *  - Vercel (serverless): a function is frozen as soon as its response is
 *    sent, so a ticker or a bare un-awaited promise never runs. Each chunk
 *    runs under waitUntil() instead, and when a chunk ends with work left it
 *    hands off to a fresh invocation via the signed /internal/jobs/:id/continue
 *    endpoint. The job page's 2 s poll also nudges the job, so a broken
 *    hand-off can't strand it while anyone is watching.
 *
 * The runner's claim guarantees only one chunk works a job at a time no
 * matter how many of these fire at once.
 */
const ON_VERCEL = Boolean(process.env.VERCEL);

const inFlight = new Set<string>();

export function jobContinueSignature(jobId: string): string {
  return createHmac("sha256", process.env.SHOPIFY_API_SECRET || "").update(`continue:${jobId}`).digest("hex");
}

export function verifyJobContinueSignature(jobId: string, signature: string | null): boolean {
  if (!signature || !process.env.SHOPIFY_API_SECRET) return false;
  const expected = Buffer.from(jobContinueSignature(jobId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function handOff(jobId: string) {
  const job = await prisma.bulkJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job || !(ACTIVE_STATUSES as readonly string[]).includes(job.status)) return;
  const base = resolveAppUrl();
  if (!base) {
    console.error(`[jobs] ${jobId}: can't hand off to the next chunk: no app URL configured. The job continues when its page is open.`);
    return;
  }
  try {
    const res = await fetch(`${base}/internal/jobs/${jobId}/continue`, {
      method: "POST",
      headers: { "x-bulkflow-signature": jobContinueSignature(jobId) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? " (Vercel Deployment Protection on this domain would cause this)" : "";
      console.error(`[jobs] ${jobId}: hand-off to next chunk got HTTP ${res.status}${hint}. The job continues when its page is open.`);
    }
  } catch (err) {
    console.error(`[jobs] ${jobId}: hand-off to next chunk failed:`, err);
  }
}

export function kickJob(jobId: string) {
  // DISABLE_JOB_WORKER=1 means this process never processes jobs, including
  // the nudge a job page gives an active job (tests, screenshots, admin tools).
  if (process.env.DISABLE_JOB_WORKER === "1" || inFlight.has(jobId)) return;
  inFlight.add(jobId);
  const work = runJobChunk(jobId, { prisma, getDeps: depsForShop, enforceLimits: BILLING_ENABLED })
    // Only the invocation that actually held the claim schedules the next
    // chunk; others (e.g. a page poll that lost the race) just stop, which
    // prevents a ping-pong of hand-offs while a chunk is running.
    .then((didWork) => (ON_VERCEL && didWork ? handOff(jobId) : undefined))
    .catch((err) => console.error(`[jobs] chunk for ${jobId} crashed:`, err))
    .finally(() => inFlight.delete(jobId));
  // Keeps the serverless invocation alive until the chunk (and hand-off) finish.
  // A no-op on a long-lived server, where the promise simply runs.
  waitUntil(work);
}

/** Restarts the shop's paused jobs if it has allowance again (after an upgrade, credit purchase or period reset). */
export async function resumeShopJobs(shop: string) {
  const ids = await resumePausedJobs(prisma, shop);
  for (const id of ids) kickJob(id);
  return ids.length;
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
  if (ON_VERCEL || global.bulkFlowWorkerStarted || process.env.DISABLE_JOB_WORKER === "1") return;
  global.bulkFlowWorkerStarted = true;
  setInterval(() => {
    tick().catch((err) => console.error("[jobs] worker tick failed:", err));
  }, TICK_MS).unref();
}
