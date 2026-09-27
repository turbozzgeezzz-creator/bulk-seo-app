import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ACTIVE_STATUSES, cancelJob, retryFailedItems } from "../lib/jobs/runner.server";
import { kickJob } from "../lib/jobs/worker.server";
import { JOB_TYPE_LABEL, unitFor } from "../components/jobDisplay";
import {
  ActivityFeed,
  Diff,
  LivePanel,
  OutcomeHeader,
  POLL_MS,
  ReasonText,
  ResultStats,
  SectionHead,
  StatTile,
  Thumb,
  isActive,
  productAdminUrl,
  ui,
} from "../components/app/AppUi";
import { IAlert, ICheck, ISkip } from "../components/app/icons";

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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

  // Items finished since roughly the previous poll get the feed's entrance
  // highlight. Decided here, not in the browser, so rendering stays pure.
  const freshSince = Date.now() - POLL_MS * 1.5;

  return {
    job,
    failures: failures.map((f) => ({ id: f.id, label: f.label, productId: f.productId, imageUrl: f.imageUrl, error: f.error })),
    updates: updates.map((u) => ({
      id: u.id,
      label: u.label,
      productId: u.productId,
      imageUrl: u.imageUrl,
      before: parseJson(u.before),
      after: parseJson(u.after),
      updatedAt: u.updatedAt,
      fresh: u.updatedAt.getTime() > freshSince,
    })),
    flagged: flagged.map((f) => ({ id: f.id, label: f.label, productId: f.productId, imageUrl: f.imageUrl, note: f.note })),
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

export default function JobPage() {
  const { job, failures, updates, flagged, retrying } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const active = isActive(job.status);
  const busyIntent = fetcher.state !== "idle" ? fetcher.formData?.get("intent") : null;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [active, revalidator]);

  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const retryButton =
    !active && job.failed > 0 ? (
      <s-button variant="primary" loading={busyIntent === "retry-failed" || undefined} onClick={() => fetcher.submit({ intent: "retry-failed" }, { method: "POST" })}>
        Retry {job.failed.toLocaleString()} failed {unitFor(job.type, job.failed)}
      </s-button>
    ) : null;

  return (
    <s-page heading={JOB_TYPE_LABEL[job.type]}>
      {/* ---------- Header: live progress, or the outcome ---------- */}
      <s-section>
        {/* Keyed by active/finished so the switch to the outcome view fades in once. */}
        <div key={active ? "live" : "done"} className={ui.fadeIn}>
          <s-stack direction="block" gap="base">
            {active ? <LivePanel job={job} /> : <OutcomeHeader job={job} />}

            {job.status === "FAILED" && job.error && (
              <s-banner tone="critical" heading="Why it stopped">
                {job.error}
              </s-banner>
            )}
            {job.status === "COMPLETED" && job.total === 0 && (
              <s-banner tone="success" heading="Nothing to do">
                Every {job.type === "ALT_TEXT" ? "image" : "product"} already has a value, so nothing was changed.
              </s-banner>
            )}
            {job.status === "CANCELLED" && (
              <s-banner tone="info">Everything updated before you stopped the job stays updated. Start a new job any time to pick up the rest.</s-banner>
            )}
            {error && <s-banner tone="critical">{error}</s-banner>}

            <s-stack direction="inline" gap="base">
              {active && (
                <s-button tone="critical" variant="secondary" loading={busyIntent === "cancel" || undefined} onClick={() => fetcher.submit({ intent: "cancel" }, { method: "POST" })}>
                  Stop job
                </s-button>
              )}
              {retryButton}
              {!active && (
                <s-button variant={retryButton ? "secondary" : "primary"} href="/app/new">
                  Start another job
                </s-button>
              )}
              <s-button variant="tertiary" href="/app">
                Back to dashboard
              </s-button>
            </s-stack>
          </s-stack>
        </div>
      </s-section>

      {/* ---------- Counts ---------- */}
      <div style={{ marginBottom: 16 }}>
        {active ? (
          <div className={ui.stats}>
            <StatTile icon={<ICheck size={14} />} tone="ok" label="Updated & verified" value={job.succeeded} />
            <StatTile icon={<IAlert size={14} />} tone={job.failed ? "warn" : "muted"} label="Need attention" value={job.failed} />
            <StatTile icon={<ISkip size={14} />} tone="muted" label="Skipped" value={job.skipped} />
          </div>
        ) : (
          job.total > 0 && <ResultStats job={job} />
        )}
      </div>

      {/* ---------- Live feed ---------- */}
      {active && (
        <s-section>
          <SectionHead title="Happening now" />
          {updates.length > 0 ? (
            <ActivityFeed items={updates.slice(0, 8)} />
          ) : (
            <s-text color="subdued">
              {job.status === "SCANNING"
                ? "Finding the items that need work. The first results appear here within a few seconds."
                : "Writing the first values. They appear here as soon as Shopify confirms them."}
            </s-text>
          )}
        </s-section>
      )}

      {active && retrying.length > 0 && (
        <s-section>
          <SectionHead title="Retrying automatically" count={retrying.length} />
          <s-text color="subdued">These hit a temporary problem and will be tried again shortly. Nothing to do.</s-text>
          <ul className={ui.rows} style={{ marginTop: 8 }}>
            {retrying.map((r) => (
              <li key={r.id} className={ui.resultRow} style={{ gridTemplateColumns: "1fr auto" }}>
                <span>
                  <span className={ui.resultName}>{r.label}</span>
                  <div className={ui.note} style={{ color: "var(--bf-muted)" }}>
                    {r.error}
                  </div>
                </span>
                <s-badge>Attempt {r.attempts}</s-badge>
              </li>
            ))}
          </ul>
        </s-section>
      )}

      {/* ---------- Results ---------- */}
      {failures.length > 0 && (
        <s-section>
          <SectionHead title="Needs attention" count={job.failed} bad />
          <ul className={ui.rows}>
            {failures.map((f) => (
              <li key={f.id} className={ui.resultRow}>
                <Thumb src={f.imageUrl} alt={f.label} />
                <span>
                  <span className={ui.resultName}>{f.label}</span>
                  <ReasonText>{f.error}</ReasonText>
                </span>
                <s-link href={productAdminUrl(f.productId)} target="_blank">
                  Open product
                </s-link>
              </li>
            ))}
          </ul>
          {job.failed > failures.length && (
            <s-text color="subdued">
              Showing the latest {failures.length} of {job.failed.toLocaleString()}.{active ? "" : " Retrying includes all of them."}
            </s-text>
          )}
        </s-section>
      )}

      {flagged.length > 0 && (
        <s-section>
          <SectionHead title="Photos that may not match their product" count={flagged.length} />
          <s-text color="subdued">Alt text was still written, describing what each photo actually shows. Worth a quick look in case an image is on the wrong product.</s-text>
          <ul className={ui.rows} style={{ marginTop: 8 }}>
            {flagged.map((f) => (
              <li key={f.id} className={ui.resultRow}>
                <Thumb src={f.imageUrl} alt={f.label} />
                <span>
                  <span className={ui.resultName}>{f.label}</span>
                  <div className={ui.note}>{f.note}</div>
                </span>
                <s-link href={productAdminUrl(f.productId)} target="_blank">
                  Open product
                </s-link>
              </li>
            ))}
          </ul>
        </s-section>
      )}

      {!active && updates.length > 0 && (
        <s-section>
          <SectionHead title="Changes" count={job.succeeded} />
          <ul className={ui.rows}>
            {updates.map((u) => (
              <li key={u.id} className={ui.resultRow}>
                <Thumb src={u.imageUrl} alt={u.label} />
                <span style={{ minWidth: 0 }}>
                  <span className={ui.resultName}>{u.label}</span>
                  <Diff before={u.before} after={u.after} />
                </span>
                <s-link href={productAdminUrl(u.productId)} target="_blank">
                  Open product
                </s-link>
              </li>
            ))}
          </ul>
          {job.succeeded > updates.length && (
            <div style={{ marginTop: 8 }}>
              <s-text color="subdued">
                Showing the {updates.length} most recent of {job.succeeded.toLocaleString()} changes.
              </s-text>
            </div>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
