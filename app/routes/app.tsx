import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, isRouteErrorResponse, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, requireConfig } from "../shopify.server";
import { ensureWorkerStarted, resumeShopJobs } from "../lib/jobs/worker.server";
import { ui } from "../components/app/AppUi";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireConfig();
  const started = Date.now();
  const { session } = await authenticate.admin(request);
  const authMs = Date.now() - started;
  ensureWorkerStarted();
  // Plans are never forced here: every shop starts on Free and chooses on
  // /app/billing. A new usage period may have started since the last visit,
  // so restart any job that was paused for lack of allowance.
  await resumeShopJobs(session.shop).catch((err) => console.error(`[billing] resuming paused jobs for ${session.shop} failed:`, err));

  // One line per admin page load, so the Vercel logs show that requests
  // arrive and how long sign-in took.
  console.log(`[timing] ${new URL(request.url).pathname} for ${session.shop}: sign-in ${authMs} ms, total ${Date.now() - started} ms`);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  // Moving between pages waits on the server; show that it's happening.
  const loading = useNavigation().state === "loading";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/new">New job</s-link>
        <s-link href="/app/jobs">Job history</s-link>
        <s-link href="/app/billing">Plan & usage</s-link>
      </s-app-nav>
      {loading && <div className={ui.navProgress} role="progressbar" aria-label="Loading" />}
      <div className={loading ? ui.pageBusy : undefined}>
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  // Not boundary.error(): it recognises thrown Responses by class name
  // ("ErrorResponseImpl"), which the minified browser bundle renames, so in
  // a real browser it re-threw and every "BulkFlow can't start" page was
  // replaced by React Router's bare "500" after hydration.
  if (isRouteErrorResponse(error)) {
    return <div dangerouslySetInnerHTML={{ __html: typeof error.data === "string" && error.data ? error.data : "Handling response" }} />;
  }
  // Anything else (a timed-out database query, a Shopify API error) would
  // otherwise fall through to React Router's bare default page. Production
  // builds hide the server's message, so say what to do; the Vercel logs
  // carry the step that failed ("[slow] …" / the error itself).
  return (
    <main style={{ maxWidth: 640, margin: "48px auto", padding: 24, background: "#fff", borderRadius: 12, font: "14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif", color: "#303030", boxShadow: "0 1px 0 rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.06)" }}>
      <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 600, color: "#8e1f0b", letterSpacing: ".04em", textTransform: "uppercase" }}>BulkFlow hit a problem</p>
      <h1 style={{ margin: "0 0 12px", fontSize: 20 }}>This page couldn&apos;t load</h1>
      <p style={{ margin: "0 0 12px" }}>A step BulkFlow needed (usually the database or Shopify) failed or didn&apos;t answer in time, so it stopped waiting rather than leave the page blank. Nothing in your store was changed.</p>
      <p style={{ margin: 0, padding: 12, borderRadius: 8, background: "#fff1c7" }}>
        <strong>What to do:</strong> reload the app. If it keeps happening, send the Vercel log lines from that minute (they name the step that failed).
      </p>
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
