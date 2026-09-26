import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/** Mandatory compliance webhook. No customer data is stored, so there is nothing to erase. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}: no customer data is stored by this app.`);
  return new Response();
};
