import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Stop any running jobs: without a session they can't reach the store, and
  // they should say why rather than fail item by item. Job history is kept
  // until Shopify sends shop/redact (48 hours after uninstall), in case the
  // merchant reinstalls.
  await db.bulkJob.updateMany({
    where: { shop, status: { in: ["SCANNING", "RUNNING"] } },
    data: { status: "FAILED", error: "The app was uninstalled while this job was running.", finishedAt: new Date() },
  });
  await db.shop.updateMany({ where: { shop }, data: { uninstalledAt: new Date() } });

  return new Response();
};
