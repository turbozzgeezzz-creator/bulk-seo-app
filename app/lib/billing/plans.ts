/**
 * BulkFlow's plans and credit packs.
 *
 * ⚠ PRICES ARE A PROPOSAL awaiting the app owner's approval (see
 * docs/PRICING_PROPOSAL.md). Nothing is charged unless BILLING_ENABLED=true,
 * and charges stay in Shopify test mode unless BILLING_TEST=false.
 *
 * One "item" is one successful, verified write: one image's alt text, or one
 * product's meta title + description. Failed and skipped items never count.
 */

export type PlanKey = "FREE" | "STARTER" | "GROWTH" | "PRO";

export interface Plan {
  key: PlanKey;
  /** Shown on Shopify's approval screen and the merchant's invoice; also the Billing API plan name. */
  name: string;
  label: string;
  monthlyPrice: number;
  /** Items included per 30-day period. */
  includedItems: number;
  blurb: string;
  highlight?: boolean;
}

export const CURRENCY = "USD";
/** Free trial on paid plans. The Free plan already lets merchants try BulkFlow without a card. */
export const TRIAL_DAYS = 7;

export const PLANS: Record<PlanKey, Plan> = {
  FREE: { key: "FREE", name: "BulkFlow Free", label: "Free", monthlyPrice: 0, includedItems: 50, blurb: "Try BulkFlow on part of your catalog. No card needed." },
  STARTER: { key: "STARTER", name: "BulkFlow Starter", label: "Starter", monthlyPrice: 19, includedItems: 500, blurb: "For small catalogs that add products now and then." },
  GROWTH: { key: "GROWTH", name: "BulkFlow Growth", label: "Growth", monthlyPrice: 49, includedItems: 1_500, blurb: "For growing stores with regular new arrivals.", highlight: true },
  PRO: { key: "PRO", name: "BulkFlow Pro", label: "Pro", monthlyPrice: 149, includedItems: 6_000, blurb: "For large catalogs and frequent full refreshes." },
};

export const PAID_PLANS = [PLANS.STARTER, PLANS.GROWTH, PLANS.PRO];

export interface CreditPack {
  key: string;
  name: string;
  credits: number;
  price: number;
}

/** Credits cost more per item than any plan, so upgrading stays the better deal for regular use. */
export const CREDIT_PACKS: CreditPack[] = [
  { key: "CREDITS_250", name: "BulkFlow 250 credits", credits: 250, price: 15 },
  { key: "CREDITS_1000", name: "BulkFlow 1,000 credits", credits: 1_000, price: 49 },
  { key: "CREDITS_5000", name: "BulkFlow 5,000 credits", credits: 5_000, price: 199 },
];

export const PERIOD_DAYS = 30;

export function planFor(key: string | null | undefined): Plan {
  return PLANS[(key ?? "FREE") as PlanKey] ?? PLANS.FREE;
}

export function planByName(name: string): Plan | undefined {
  return Object.values(PLANS).find((p) => p.name === name);
}

export function packByName(name: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.name === name);
}
