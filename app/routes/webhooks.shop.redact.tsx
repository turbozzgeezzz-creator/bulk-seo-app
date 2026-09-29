import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory compliance webhook, sent 48 hours after a store uninstalls.
 * Deletes everything this app holds for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const [items, jobs, sessions, shops] = await db.$transaction([
    // (AuthBounce holds only a counter per shop; deleted alongside.)
    db.bulkJobItem.deleteMany({ where: { shop } }),
    db.bulkJob.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
    db.shop.deleteMany({ where: { shop } }),
    db.authBounce.deleteMany({ where: { shop } }),
  ]);
  console.log(
    `Received ${topic} webhook for ${shop}: deleted ${items.count} job items, ${jobs.count} jobs, ${sessions.count} sessions, ${shops.count} shop record.`,
  );
  return new Response();
};
