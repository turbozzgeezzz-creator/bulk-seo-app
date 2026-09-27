import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { STATUS_DISPLAY } from "../components/jobDisplay";
import { EmptyState } from "../components/JobProgress";
import { JobRow, POLL_MS, isActive, ui } from "../components/app/AppUi";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobs = await prisma.bulkJob.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" }, take: 100 });
  return { jobs: jobs.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() })) };
};

export default function Jobs() {
  const { jobs } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const anyActive = jobs.some((j) => isActive(j.status));

  // Running jobs in the list stay current.
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => revalidator.state === "idle" && revalidator.revalidate(), POLL_MS);
    return () => clearInterval(t);
  }, [anyActive, revalidator]);

  return (
    <s-page heading="Job history">
      <s-button slot="primary-action" variant="primary" href="/app/new">
        New job
      </s-button>
      <s-section>
        {jobs.length === 0 ? (
          <EmptyState title="Your job history will appear here">
            Every bulk run is kept with its before and after values, so you can always see exactly what changed.
            <div style={{ marginTop: 12 }}>
              <s-button variant="primary" href="/app/new">
                Start your first job
              </s-button>
            </div>
          </EmptyState>
        ) : (
          <div className={ui.jobList}>
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} badge={<s-badge tone={STATUS_DISPLAY[job.status]?.tone}>{STATUS_DISPLAY[job.status]?.label ?? job.status}</s-badge>} />
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
