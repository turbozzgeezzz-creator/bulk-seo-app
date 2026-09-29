import { BillingInterval } from "@shopify/shopify-app-react-router/server";
import { CREDIT_PACKS, CURRENCY, PAID_PLANS, TRIAL_DAYS } from "./lib/billing/plans";

/**
 * Billing API configuration built from app/lib/billing/plans.ts.
 *
 *   BILLING_ENABLED=true   turn plan limits and charging on (default off:
 *                          usage is still counted, nothing is blocked or charged)
 *   BILLING_TEST=false     charge for real (default: Shopify test charges)
 *
 * Shopify only accepts Billing API calls from apps with public distribution.
 */

export const BILLING_ENABLED = process.env.BILLING_ENABLED === "true";
export const BILLING_IS_TEST = process.env.BILLING_TEST !== "false";

export const billingConfig = {
  ...Object.fromEntries(
    PAID_PLANS.map((p) => [
      p.name,
      {
        trialDays: TRIAL_DAYS,
        lineItems: [{ amount: p.monthlyPrice, currencyCode: CURRENCY, interval: BillingInterval.Every30Days as const }],
      },
    ]),
  ),
  ...Object.fromEntries(CREDIT_PACKS.map((c) => [c.name, { amount: c.price, currencyCode: CURRENCY, interval: BillingInterval.OneTime as const }])),
};
