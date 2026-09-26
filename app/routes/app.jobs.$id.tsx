import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ACTIVE_STATUSES, cancelJob, retryFailedItems } from "../lib/jobs/runner.server";
import { kickJob } from "../lib/jobs/worker.server";
import { JOB_TYPE_LABEL, MODE_LABEL, STATUS_DISPLAY, unitFor } from "../components/jobDisplay";
import { ProgressBar } from "../components/ProgressBar";

const POLL_MS = 2000;

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatValue(v: unknown): string {
  if (v == null || v === "") return "(blank)";
  if (typeof v === "string") return v;
  const seo = v as { title?: string | null; description?: string | null };
  return `Title: ${seo.title || "(blank)"}\nDescription: ${seo.description || "(blank)"}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const job = await prisma.bulkJob.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!job) throw new Response("Job not found", { status: 404 });

  // Belt and braces alongside the background ticker: viewing an active job
  // nudges it, so progress never depends on a single mechanism.
  if ((ACTIVE_STATUSES as readonly string[]).includes(job.status)) kickJob(job.id);

  const [failures, updates, flagged, pending] = await Promise.all([
    prisma.bulkJobItem.findMany({ where: { jobId: job.id, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.bulkJobItem.findMany({ where: { jobId: job.id, status: "SUCCEEDED" }, orderBy: { updatedAt: "desc" }, take: 25 }),
    prisma.bulkJobItem.findMany({ where: { jobId: job.id, status: "SUCCEEDED", note: { not: null } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.bulkJobItem.findMany({ where: { jobId: job.id, status: "PENDING", attempts: { gt: 0 } }, orderBy: { updatedAt: "desc" }, take: 20 }),
  ]);

  return {
    job,
    failures: failures.map((f) => ({ id: f.id, label: f.label, productId: f.productId, error: f.error })),
    updates: updates.map((u) => ({ id: u.id, label: u.label, before: parseJson(u.before), after: parseJson(u.after) })),
    flagged: flagged.map((f) => ({ id: f.id, label: f.label, productId: f.productId, note: f.note })),
    retrying: pending.map((p) => ({ id: p.id, label: p.label, error: p.error, attempts: p.attempts })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");
  if (intent === "cancel") {
    const ok = await cancelJob(prisma, session.shop, params.id!);
    return ok ? { ok: true } : { error: "This job has already finished." };
  }
  if (intent === "retry-failed") {
    const result = await retryFailedItems(prisma, session.shop, params.id!);
    if (!result.ok) return { error: result.error };
    kickJob(result.jobId);
    throw redirect(`/app/jobs/${result.jobId}`);
  }
  return { error: "Unknown action." };
};

function productAdminUrl(productGid: string) {
  return `shopify://admin/products/${productGid.split("/").pop()}`;
}

export default function JobPage() {
  const { job, failures, updates, flagged, retrying } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const active = job.status === "SCANNING" || job.status === "RUNNING";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [active, revalidator]);

  const status = STATUS_DISPLAY[job.status] ?? { label: job.status, tone: "neutral" as const };
  const unit = unitFor(job.type, job.total);
  const alreadyDone = job.scanned - job.total;

  return (
    <s-page heading={JOB_TYPE_LABEL[job.type]}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            <s-badge tone={status.tone}>{status.label}</s-badge>
            <s-text color="subdued">{MODE_LABEL[job.mode]}</s-text>
          </s-stack>

          {job.status === "SCANNING" ? (
            <s-text>
              Scanning your catalog… {job.scanned} {unitFor(job.type, job.scanned)} checked, {job.total} need work so far.
            </s-text>
          ) : (
            <s-heading>
              {job.processed} of {job.total} {unit} processed
            </s-heading>
          )}
          <ProgressBar value={job.processed} max={Math.max(job.total, 1)} label="Job progress" />
          <s-text>
            {job.succeeded} updated · {job.failed} failed · {job.skipped} skipped
            {job.scanComplete && job.mode === "ONLY_MISSING" && alreadyDone > 0
              ? ` · ${alreadyDone} ${unitFor(job.type, alreadyDone)} already had values and were left alone`
              : ""}
          </s-text>

          {job.status === "FAILED" && job.error && <s-banner tone="critical" heading="This job stopped">{job.error}</s-banner>}
          {job.status === "COMPLETED" && job.total === 0 && (
            <s-banner tone="success">Nothing to do: every {job.type === "ALT_TEXT" ? "image" : "product"} already has a value.</s-banner>
          )}
          {fetcher.data && "error" in fetcher.data && fetcher.data.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}

          <s-stack direction="inline" gap="base">
            {active && (
              <s-button tone="critical" variant="secondary" onClick={() => fetcher.submit({ intent: "cancel" }, { method: "POST" })}>
                Stop job
              </s-button>
            )}
            {!active && job.failed > 0 && (
              <s-button variant="primary" onClick={() => fetcher.submit({ intent: "retry-failed" }, { method: "POST" })}>
                Retry {job.failed} failed {unitFor(job.type, job.failed)}
              </s-button>
            )}
            <s-button href="/app" variant="tertiary">
              Back
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {retrying.length > 0 && active && (
        <s-section heading="Retrying">
          <s-paragraph>These hit a temporary problem and will be tried again automatically.</s-paragraph>
          <s-unordered-list>
            {retrying.map((r) => (
              <s-list-item key={r.id}>
                {r.label}: {r.error} (attempt {r.attempts})
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-section>
      )}

      {failures.length > 0 && (
        <s-section heading={`Couldn't update (${job.failed})`}>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Item</s-table-header>
              <s-table-header listSlot="labeled">Reason</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {failures.map((f) => (
                <s-table-row key={f.id}>
                  <s-table-cell>
                    <s-link href={productAdminUrl(f.productId)} target="_blank">
                      {f.label}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{f.error}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {flagged.length > 0 && (
        <s-section heading="Photos that may not match their product">
          <s-paragraph>Alt text was still written for these, describing what the photo shows. You may want to check the image is on the right product.</s-paragraph>
          <s-unordered-list>
            {flagged.map((f) => (
              <s-list-item key={f.id}>
                <s-link href={productAdminUrl(f.productId)} target="_blank">
                  {f.label}
                </s-link>
                : {f.note}
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-section>
      )}

      {updates.length > 0 && (
        <s-section heading="Latest updates">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Item</s-table-header>
              <s-table-header listSlot="labeled">Before</s-table-header>
              <s-table-header listSlot="labeled">After</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {updates.map((u) => (
                <s-table-row key={u.id}>
                  <s-table-cell>{u.label}</s-table-cell>
                  <s-table-cell>
                    <span style={{ whiteSpace: "pre-line" }}>{formatValue(u.before)}</span>
                  </s-table-cell>
                  <s-table-cell>
                    <span style={{ whiteSpace: "pre-line" }}>{formatValue(u.after)}</span>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
