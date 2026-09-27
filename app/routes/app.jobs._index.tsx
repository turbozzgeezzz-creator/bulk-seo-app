import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { JOB_TYPE_LABEL, MODE_LABEL, STATUS_DISPLAY } from "../components/jobDisplay";
import { EmptyState } from "../components/JobProgress";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobs = await prisma.bulkJob.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" }, take: 100 });
  return { jobs: jobs.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() })) };
};

export default function Jobs() {
  const { jobs } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Job history">
      <s-section>
        {jobs.length === 0 ? (
          <EmptyState title="Your job history will appear here">
            Every bulk run is kept with its before and after values, so you can always see exactly what changed.{" "}
            <s-link href="/app">Start your first job</s-link>
          </EmptyState>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Job</s-table-header>
              <s-table-header>Started</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Updated</s-table-header>
              <s-table-header format="numeric">Failed</s-table-header>
              <s-table-header format="numeric">Skipped</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((job) => (
                <s-table-row key={job.id}>
                  <s-table-cell>
                    <s-link href={`/app/jobs/${job.id}`}>
                      {JOB_TYPE_LABEL[job.type]} · {MODE_LABEL[job.mode]}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{new Date(job.createdAt).toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_DISPLAY[job.status]?.tone}>{STATUS_DISPLAY[job.status]?.label ?? job.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{job.succeeded}</s-table-cell>
                  <s-table-cell>{job.failed}</s-table-cell>
                  <s-table-cell>{job.skipped}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
