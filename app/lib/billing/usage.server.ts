import type { PrismaClient } from "@prisma/client";
import { PERIOD_DAYS, packByName, planByName, planFor, type PlanKey } from "./plans";

/**
 * Per-shop usage metering.
 *
 * Each item reserves one unit *before* it is processed, with a conditional
 * update (so concurrent jobs for one shop can never overspend), and gives it
 * back if the item doesn't end in a verified write. Included plan volume is
 * used first, then credits. When `enforce` is false (billing not switched on)
 * usage is still counted, but never blocks.
 */

export type Unit = "included" | "credit";

const PERIOD_MS = PERIOD_DAYS * 86_400_000;

export async function ensureShop(prisma: PrismaClient, shop: string) {
  await prisma.shop.upsert({ where: { shop }, create: { shop }, update: {} });
}

/** Starts a new period for the shop if the current one has ended (idempotent under concurrency). */
export async function rolloverIfDue(prisma: PrismaClient, shop: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - PERIOD_MS);
  await prisma.shop.updateMany({
    where: { shop, periodStart: { lte: cutoff } },
    data: { periodStart: now, usedThisPeriod: 0, creditsUsedThisPeriod: 0 },
  });
}

export async function reserveUnit(prisma: PrismaClient, shop: string, enforce: boolean): Promise<Unit | null> {
  const row = await prisma.shop.findUnique({ where: { shop }, select: { plan: true } });
  const included = planFor(row?.plan).includedItems;
  const fromPlan = await prisma.shop.updateMany({ where: { shop, usedThisPeriod: { lt: included } }, data: { usedThisPeriod: { increment: 1 } } });
  if (fromPlan.count === 1) return "included";
  const fromCredits = await prisma.shop.updateMany({
    where: { shop, creditBalance: { gt: 0 } },
    data: { creditBalance: { decrement: 1 }, creditsUsedThisPeriod: { increment: 1 } },
  });
  if (fromCredits.count === 1) return "credit";
  if (enforce) return null;
  await prisma.shop.updateMany({ where: { shop }, data: { usedThisPeriod: { increment: 1 } } });
  return "included";
}

export async function refundUnit(prisma: PrismaClient, shop: string, unit: Unit) {
  if (unit === "credit") {
    await prisma.shop.updateMany({ where: { shop }, data: { creditBalance: { increment: 1 }, creditsUsedThisPeriod: { decrement: 1 } } });
  } else {
    await prisma.shop.updateMany({ where: { shop, usedThisPeriod: { gt: 0 } }, data: { usedThisPeriod: { decrement: 1 } } });
  }
}

export interface UsageSummary {
  plan: PlanKey;
  planLabel: string;
  included: number;
  used: number;
  creditsUsed: number;
  creditBalance: number;
  /** Items the shop can still process this period (included left + credits). */
  remaining: number;
  periodStart: Date;
  periodEnd: Date;
}

export async function usageFor(prisma: PrismaClient, shop: string, now = new Date()): Promise<UsageSummary> {
  await ensureShop(prisma, shop);
  await rolloverIfDue(prisma, shop, now);
  const row = await prisma.shop.findUniqueOrThrow({ where: { shop } });
  const plan = planFor(row.plan);
  return {
    plan: plan.key,
    planLabel: plan.label,
    included: plan.includedItems,
    used: row.usedThisPeriod,
    creditsUsed: row.creditsUsedThisPeriod,
    creditBalance: row.creditBalance,
    remaining: Math.max(0, plan.includedItems - row.usedThisPeriod) + row.creditBalance,
    periodStart: row.periodStart,
    periodEnd: new Date(row.periodStart.getTime() + PERIOD_MS),
  };
}

/** Jobs paused for lack of allowance go back to RUNNING once there is some. Returns the resumed job ids. */
export async function resumePausedJobs(prisma: PrismaClient, shop: string): Promise<string[]> {
  const { remaining } = await usageFor(prisma, shop);
  if (remaining <= 0) return [];
  const paused = await prisma.bulkJob.findMany({ where: { shop, status: "PAUSED" }, select: { id: true } });
  if (paused.length === 0) return [];
  await prisma.bulkJob.updateMany({ where: { id: { in: paused.map((p) => p.id) }, status: "PAUSED" }, data: { status: "RUNNING", error: null } });
  return paused.map((p) => p.id);
}

// ---------------------------------------------------------------- syncing from Shopify

interface ShopifySubscription {
  id: string;
  name: string;
  status?: string;
}
interface ShopifyOneTimePurchase {
  id: string;
  name: string;
  status: string;
  test?: boolean;
}

/** Sets the shop's plan from its active Shopify subscriptions (FREE when none). Returns the plan key. */
export async function syncPlan(prisma: PrismaClient, shop: string, subscriptions: ShopifySubscription[]): Promise<PlanKey> {
  const active = subscriptions.filter((s) => !s.status || s.status === "ACTIVE");
  const match = active.map((s) => ({ s, plan: planByName(s.name) })).find((m) => m.plan);
  const plan = match?.plan?.key ?? "FREE";
  await ensureShop(prisma, shop);
  await prisma.shop.update({ where: { shop }, data: { plan, subscriptionId: match?.s.id ?? null } });
  return plan;
}

/**
 * Credits every ACTIVE (approved and charged) credit-pack purchase not yet
 * credited. Keyed on Shopify's purchase id, so running it again is harmless.
 * Returns the number of credits added.
 */
export async function syncCreditPurchases(prisma: PrismaClient, shop: string, purchases: ShopifyOneTimePurchase[]): Promise<number> {
  let added = 0;
  for (const p of purchases) {
    const pack = packByName(p.name);
    if (!pack || p.status !== "ACTIVE") continue;
    // The purchase row and the balance change commit together; a concurrent
    // sync of the same purchase fails on the primary key and credits nothing.
    const credited = await prisma
      .$transaction(async (tx) => {
        await tx.creditPurchase.create({ data: { id: p.id, shop, pack: pack.key, credits: pack.credits, amount: pack.price, currency: "USD", test: Boolean(p.test) } });
        await tx.shop.upsert({ where: { shop }, create: { shop, creditBalance: pack.credits }, update: { creditBalance: { increment: pack.credits } } });
        return true;
      })
      .catch((err: { code?: string }) => {
        if (err?.code === "P2002") return false;
        throw err;
      });
    if (credited) added += pack.credits;
  }
  return added;
}

/**
 * app_subscriptions/update webhook: an approved subscription becomes the
 * shop's plan; the current one ending (cancelled, declined, expired, frozen)
 * drops the shop to FREE. Events for other, older subscriptions are ignored.
 */
export async function applySubscriptionEvent(prisma: PrismaClient, shop: string, sub: { id: string; name: string; status: string }): Promise<PlanKey> {
  await ensureShop(prisma, shop);
  const row = await prisma.shop.findUniqueOrThrow({ where: { shop } });
  if (sub.status === "ACTIVE") return syncPlan(prisma, shop, [{ id: sub.id, name: sub.name, status: "ACTIVE" }]);
  if (row.subscriptionId === sub.id) return syncPlan(prisma, shop, []);
  return planFor(row.plan).key;
}
