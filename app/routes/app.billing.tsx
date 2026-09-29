import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BILLING_ENABLED, BILLING_IS_TEST } from "../billing.server";
import { CREDIT_PACKS, PAID_PLANS, PLANS, TRIAL_DAYS, planFor, type PlanKey } from "../lib/billing/plans";
import { syncCreditPurchases, syncPlan, usageFor } from "../lib/billing/usage.server";
import { resumeShopJobs } from "../lib/jobs/worker.server";
import { withDeadline } from "../lib/deadline.server";
import { CreditPackCard, PlanCard, UsageMeter, billingUi } from "../components/app/BillingUi";

type BillingApi = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

/** Shopify's own words for a failed Billing API call (userErrors), not a stack trace. */
function billingErrorMessage(err: unknown): string {
  const data = (err as { errorData?: unknown })?.errorData;
  const list = Array.isArray(data) ? data : [];
  const messages = list.map((e) => (e as { message?: string })?.message).filter(Boolean);
  if (messages.length) return messages.join("; ");
  return err instanceof Error ? err.message : String(err);
}

/** Pulls the shop's subscriptions and credit purchases from Shopify into the database. */
async function syncFromShopify(billing: BillingApi, shop: string) {
  const res = await withDeadline("Shopify billing check", 15_000, () => billing.check({ isTest: BILLING_IS_TEST }));
  const plan = await syncPlan(prisma, shop, res.appSubscriptions);
  const creditsAdded = await syncCreditPurchases(prisma, shop, res.oneTimePurchases);
  const resumed = await resumeShopJobs(shop);
  return { plan, creditsAdded, resumed };
}

function returnUrl(shop: string) {
  // Back into the embedded app's billing page after approving in Shopify.
  return `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/${process.env.SHOPIFY_API_KEY}/app/billing`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  let syncError: string | null = null;
  let justAdded = 0;
  if (BILLING_ENABLED) {
    try {
      justAdded = (await syncFromShopify(billing, shop)).creditsAdded;
    } catch (err) {
      syncError = billingErrorMessage(err);
      console.error(`[billing] sync for ${shop} failed: ${syncError}`);
    }
  }
  const [usage, purchases, pausedJobs] = await Promise.all([
    usageFor(prisma, shop),
    prisma.creditPurchase.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.bulkJob.count({ where: { shop, status: "PAUSED" } }),
  ]);
  return {
    usage,
    purchases: purchases.map((p) => ({ ...p, amount: Number(p.amount) })),
    pausedJobs,
    billingEnabled: BILLING_ENABLED,
    testMode: BILLING_IS_TEST,
    syncError,
    returned: url.searchParams.has("charge_id"),
    justAdded,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (!BILLING_ENABLED) {
    return { error: "Paid plans and credits aren't switched on yet, so nothing can be bought. Everything else works as normal." };
  }
  try {
    if (intent === "subscribe") {
      const plan = PLANS[String(form.get("plan")) as PlanKey];
      if (!plan || plan.monthlyPrice === 0) return { error: "Unknown plan." };
      // Throws a redirect to Shopify's approval page.
      await billing.request({ plan: plan.name as never, isTest: BILLING_IS_TEST, returnUrl: returnUrl(session.shop) });
    }
    if (intent === "buy") {
      const pack = CREDIT_PACKS.find((p) => p.key === String(form.get("pack")));
      if (!pack) return { error: "Unknown credit pack." };
      await billing.request({ plan: pack.name as never, isTest: BILLING_IS_TEST, returnUrl: returnUrl(session.shop) });
    }
    if (intent === "cancel") {
      const row = await prisma.shop.findUnique({ where: { shop: session.shop } });
      if (row?.subscriptionId) {
        await billing.cancel({ subscriptionId: row.subscriptionId, isTest: BILLING_IS_TEST, prorate: true });
      }
      await syncPlan(prisma, session.shop, []);
      return { ok: "You're on the Free plan now. Credits you bought stay on your account." };
    }
    return { error: "Unknown action." };
  } catch (err) {
    if (err instanceof Response) throw err; // the redirect to Shopify's approval page
    const message = billingErrorMessage(err);
    console.error(`[billing] ${intent} for ${session.shop} failed: ${message}`);
    return { error: `Shopify didn't accept the billing request: ${message}` };
  }
};

export default function Billing() {
  const { usage, purchases, pausedJobs, billingEnabled, testMode, syncError, returned, justAdded } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle" ? String(nav.formData?.get("plan") ?? nav.formData?.get("pack") ?? nav.formData?.get("intent") ?? "") : "";
  const current = planFor(usage.plan);
  const error = (result && "error" in result && result.error) || syncError;

  return (
    <s-page heading="Plan & usage">
      {!billingEnabled && (
        <s-banner tone="info" heading="Pricing preview">
          Paid plans aren&apos;t live yet, so nothing is charged or limited. Your usage below is counted for real, so you can see how plans would fit your catalog.
        </s-banner>
      )}
      {billingEnabled && testMode && (
        <s-banner tone="warning" heading="Test mode">
          Charges are Shopify test charges: you can approve them to try the flow, and no money moves.
        </s-banner>
      )}
      {error && (
        <s-banner tone="critical" heading="Billing isn't available right now">
          {error}
        </s-banner>
      )}
      {result && "ok" in result && <s-banner tone="success">{result.ok}</s-banner>}
      {returned && !error && (
        <s-banner tone="success">{justAdded > 0 ? `${justAdded.toLocaleString()} credits were added to your account.` : "Your plan is up to date."}</s-banner>
      )}
      {pausedJobs > 0 && (
        <s-banner tone="warning" heading={`${pausedJobs === 1 ? "A job is" : `${pausedJobs} jobs are`} paused`}>
          {pausedJobs === 1 ? "It continues" : "They continue"} automatically as soon as you upgrade or add credits.
        </s-banner>
      )}

      <div className={billingUi.fadeIn}>
        <UsageMeter usage={usage} />
      </div>

      <s-section heading="Plans">
        <div className={billingUi.planGrid}>
          <PlanCard plan={PLANS.FREE} current={usage.plan === "FREE"}>
            {usage.plan !== "FREE" && (
              <Form method="post">
                <input type="hidden" name="intent" value="cancel" />
                <button className={billingUi.secondaryBtn} disabled={!!busy}>
                  {busy === "cancel" ? "Switching…" : "Switch to Free"}
                </button>
              </Form>
            )}
          </PlanCard>
          {PAID_PLANS.map((plan) => (
            <PlanCard key={plan.key} plan={plan} current={usage.plan === plan.key}>
              {usage.plan !== plan.key && (
                <Form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="plan" value={plan.key} />
                  <button className={plan.highlight ? billingUi.primaryBtn : billingUi.secondaryBtn} disabled={!!busy}>
                    {busy === plan.key ? "Opening Shopify…" : plan.monthlyPrice > current.monthlyPrice ? `Upgrade to ${plan.label}` : `Switch to ${plan.label}`}
                  </button>
                </Form>
              )}
            </PlanCard>
          ))}
        </div>
        <p className={billingUi.footnote}>
          Paid plans start with a {TRIAL_DAYS}-day free trial and are billed by Shopify every 30 days, on your Shopify invoice. Change or cancel any time.
        </p>
      </s-section>

      <s-section heading="Need more this month? Add credits">
        <p className={billingUi.sectionIntro}>
          Credits cover items beyond your plan, one credit per item. They&apos;re used only after your plan&apos;s included items, never expire, and are a one-time charge.
        </p>
        <div className={billingUi.packGrid}>
          {CREDIT_PACKS.map((pack) => (
            <CreditPackCard key={pack.key} pack={pack}>
              <Form method="post">
                <input type="hidden" name="intent" value="buy" />
                <input type="hidden" name="pack" value={pack.key} />
                <button className={billingUi.secondaryBtn} disabled={!!busy}>
                  {busy === pack.key ? "Opening Shopify…" : "Buy credits"}
                </button>
              </Form>
            </CreditPackCard>
          ))}
        </div>
        {purchases.length > 0 && (
          <ul className={billingUi.history}>
            {purchases.map((p) => (
              <li key={p.id}>
                <span>
                  {p.credits.toLocaleString()} credits{p.test ? " (test)" : ""}
                </span>
                <span>
                  ${p.amount.toFixed(2)} · {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </s-section>

      <s-section slot="aside" heading="What counts as an item">
        <ul className={billingUi.faq}>
          <li>
            <strong>One image&apos;s alt text</strong>, or <strong>one product&apos;s meta title and description</strong>, written and verified in your store.
          </li>
          <li>
            <strong>Failed and skipped items are free.</strong> So is anything left untouched because it already had a value.
          </li>
          <li>
            <strong>Running out never loses work.</strong> A job pauses where it is and continues when you upgrade, add credits, or your next period starts.
          </li>
        </ul>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
