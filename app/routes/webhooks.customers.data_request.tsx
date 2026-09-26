import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Mandatory compliance webhook. This app never requests customer scopes and
 * stores no customer data (only product IDs, image IDs and the SEO text it
 * generated), so there is nothing to report for a customer. authenticate.webhook
 * verifies the HMAC and returns 401 for forged requests, as the App Store requires.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}: no customer data is stored by this app.`);
  return new Response();
};
