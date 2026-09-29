import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { applySubscriptionEvent } from "../lib/billing/usage.server";
import { resumeShopJobs } from "../lib/jobs/worker.server";

/** Keeps the shop's plan in step with Shopify when a subscription is approved, changed or ends. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const sub = (payload as { app_subscription?: { admin_graphql_api_id?: string; name?: string; status?: string } }).app_subscription;
  if (sub?.admin_graphql_api_id && sub.name && sub.status) {
    const plan = await applySubscriptionEvent(db, shop, { id: sub.admin_graphql_api_id, name: sub.name, status: sub.status.toUpperCase() });
    console.log(`Received ${topic} webhook for ${shop}: "${sub.name}" is ${sub.status}; plan is now ${plan}.`);
    await resumeShopJobs(shop);
  }
  return new Response();
};
