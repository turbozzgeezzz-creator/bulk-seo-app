import { BillingInterval } from "@shopify/shopify-app-react-router/server";

/**
 * Billing API plumbing, with NO prices chosen.
 *
 * Plan names, prices, currency, trial length and usage limits are business
 * decisions for the app owner (see docs/OPEN_DECISIONS.md). Until they are
 * set via environment variables, billing is off and the app is free to use,
 * which is fine on development stores but must not ship to the App Store.
 *
 * Env vars (all required to turn billing on):
 *   BILLING_PLAN_NAME        e.g. the plan's display name
 *   BILLING_PLAN_AMOUNT      monthly price as a number
 *   BILLING_PLAN_CURRENCY    ISO code, e.g. USD
 * Optional:
 *   BILLING_TRIAL_DAYS       free trial length in days
 *   BILLING_TEST=false       charge for real (default is test charges)
 */

const name = process.env.BILLING_PLAN_NAME?.trim();
const amount = Number(process.env.BILLING_PLAN_AMOUNT);
const currencyCode = process.env.BILLING_PLAN_CURRENCY?.trim();
const trialDays = process.env.BILLING_TRIAL_DAYS ? Number(process.env.BILLING_TRIAL_DAYS) : undefined;

export const BILLING_PLAN: string | null = name && Number.isFinite(amount) && amount > 0 && currencyCode ? name : null;
export const BILLING_IS_TEST = process.env.BILLING_TEST !== "false";

export const billingConfig = BILLING_PLAN
  ? {
      [BILLING_PLAN]: {
        trialDays,
        lineItems: [{ amount, currencyCode: currencyCode!, interval: BillingInterval.Every30Days as const }],
      },
    }
  : undefined;
