import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, requireConfig } from "../shopify.server";
import { BILLING_IS_TEST, BILLING_PLAN } from "../billing.server";
import { ensureWorkerStarted } from "../lib/jobs/worker.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireConfig();
  const { billing } = await authenticate.admin(request);
  ensureWorkerStarted();

  // Billing stays off until the app owner sets a plan (docs/OPEN_DECISIONS.md).
  if (BILLING_PLAN) {
    // Plan names come from env, so TypeScript can't infer them from the config literal.
    const plan = BILLING_PLAN as never;
    await billing.require({
      plans: [plan],
      isTest: BILLING_IS_TEST,
      onFailure: async () => billing.request({ plan, isTest: BILLING_IS_TEST }),
    });
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/new">New job</s-link>
        <s-link href="/app/jobs">Job history</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
