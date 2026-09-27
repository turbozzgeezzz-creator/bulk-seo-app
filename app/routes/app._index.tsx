import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ACTIVE_STATUSES, createJob } from "../lib/jobs/runner.server";
import { kickJob } from "../lib/jobs/worker.server";
import { JOB_TYPE_LABEL, MODE_LABEL, STATUS_DISPLAY } from "../components/jobDisplay";
import { BrandHeader, EmptyState, JobProgress } from "../components/JobProgress";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [active, recent] = await Promise.all([
    prisma.bulkJob.findMany({ where: { shop, status: { in: [...ACTIVE_STATUSES] } } }),
    prisma.bulkJob.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return { active, recent };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const type = form.get("type");
  const mode = form.get("mode");
  if ((type !== "ALT_TEXT" && type !== "META") || (mode !== "ONLY_MISSING" && mode !== "OVERWRITE_ALL")) {
    return { error: "Unknown job type." };
  }
  const result = await createJob(prisma, session.shop, type, mode);
  if (!result.ok) return { error: result.error, jobId: result.jobId };
  kickJob(result.jobId);
  throw redirect(`/app/jobs/${result.jobId}`);
};

type Job = Awaited<ReturnType<typeof loader>>["recent"][number];

function JobCard({
  type,
  description,
  activeJob,
}: {
  type: "ALT_TEXT" | "META";
  description: string;
  activeJob?: Job;
}) {
  const fetcher = useFetcher<typeof action>();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const busy = fetcher.state !== "idle";
  const start = (mode: "ONLY_MISSING" | "OVERWRITE_ALL") => fetcher.submit({ type, mode }, { method: "POST" });

  return (
    <s-section heading={JOB_TYPE_LABEL[type]}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{description}</s-paragraph>
        {fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}
        {activeJob ? (
          <s-stack direction="block" gap="small-200">
            <JobProgress compact {...activeJob} />
            <s-button href={`/app/jobs/${activeJob.id}`}>View progress</s-button>
          </s-stack>
        ) : (
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" loading={busy || undefined} onClick={() => start("ONLY_MISSING")}>
              {type === "ALT_TEXT" ? "Fill in missing alt text" : "Fill in missing meta tags"}
            </s-button>
            {confirmOverwrite ? (
              <>
                <s-button tone="critical" loading={busy || undefined} onClick={() => start("OVERWRITE_ALL")}>
                  Yes, rewrite existing values too
                </s-button>
                <s-button variant="tertiary" onClick={() => setConfirmOverwrite(false)}>
                  Cancel
                </s-button>
              </>
            ) : (
              <s-button variant="secondary" onClick={() => setConfirmOverwrite(true)}>
                Rewrite everything
              </s-button>
            )}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

export default function Index() {
  const { active, recent } = useLoaderData<typeof loader>();
  const activeByType = Object.fromEntries(active.map((j) => [j.type, j]));

  return (
    <s-page heading="BulkFlow">
      <s-box paddingBlockEnd="base">
        <BrandHeader />
      </s-box>
      <JobCard
        type="ALT_TEXT"
        activeJob={activeByType.ALT_TEXT}
        description="Looks at every product photo and writes a short, specific description for shoppers using screen readers and for image search. By default only images with no alt text are touched."
      />
      <JobCard
        type="META"
        activeJob={activeByType.META}
        description="Writes the search-result title and description for each product from its own product details. By default only products missing a meta title or description are touched."
      />

      <s-section heading="Recent jobs">
        {recent.length === 0 ? (
          <EmptyState title="No jobs yet">
            Start with &ldquo;Fill in missing alt text&rdquo; above. BulkFlow only touches images that have none, and you can watch every
            product as it&apos;s done.
          </EmptyState>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Job</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Updated</s-table-header>
              <s-table-header format="numeric">Failed</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recent.map((job) => (
                <s-table-row key={job.id}>
                  <s-table-cell>
                    <s-link href={`/app/jobs/${job.id}`}>
                      {JOB_TYPE_LABEL[job.type]} · {MODE_LABEL[job.mode]}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_DISPLAY[job.status]?.tone}>{STATUS_DISPLAY[job.status]?.label ?? job.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{job.succeeded}</s-table-cell>
                  <s-table-cell>{job.failed}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-unordered-list>
          <s-list-item>Changes are written straight to your store. Every previous value is kept in the job&apos;s history.</s-list-item>
          <s-list-item>An item only counts as updated after the new value is read back from Shopify.</s-list-item>
          <s-list-item>Anything that couldn&apos;t be updated is listed with the reason, and you can retry just those.</s-list-item>
          <s-list-item>Jobs keep running if you close this page.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
