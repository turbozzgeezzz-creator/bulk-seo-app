import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ACTIVE_STATUSES, PAUSED, createJob } from "../lib/jobs/runner.server";
import { usageFor } from "../lib/billing/usage.server";
import { BILLING_ENABLED } from "../billing.server";
import { kickJob } from "../lib/jobs/worker.server";
import { ui } from "../components/app/AppUi";
import { ICheck, IEye, IFill, IImage, IRewrite, ISearch, IShield } from "../components/app/icons";

type JobType = "ALT_TEXT" | "META";
type Mode = "ONLY_MISSING" | "OVERWRITE_ALL";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [active, usage] = await Promise.all([
    prisma.bulkJob.findMany({
      where: { shop: session.shop, status: { in: [...ACTIVE_STATUSES, PAUSED] } },
      select: { id: true, type: true },
    }),
    usageFor(prisma, session.shop),
  ]);
  return { active, remaining: usage.remaining, planLabel: usage.planLabel, billingEnabled: BILLING_ENABLED };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const type = form.get("type");
  const mode = form.get("mode");
  if ((type !== "ALT_TEXT" && type !== "META") || (mode !== "ONLY_MISSING" && mode !== "OVERWRITE_ALL")) {
    return { error: "Choose what to write and which items to include." };
  }
  if (mode === "OVERWRITE_ALL" && form.get("confirmOverwrite") !== "yes") {
    return { error: "Confirm that existing values will be replaced before rewriting everything." };
  }
  const result = await createJob(prisma, session.shop, type, mode);
  if (!result.ok) return { error: result.error, jobId: result.jobId };
  kickJob(result.jobId);
  throw redirect(`/app/jobs/${result.jobId}`);
};

function Option<T extends string>({
  name,
  value,
  selected,
  onSelect,
  icon,
  title,
  pill,
  text,
  warn,
  disabled,
}: {
  name: string;
  value: T;
  selected: boolean;
  onSelect: (v: T) => void;
  icon: React.ReactNode;
  title: string;
  pill?: string;
  text: string;
  warn?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={`${ui.option} ${selected ? ui.optionSelected : ""} ${warn ? ui.optionWarn : ""}`}
      style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
    >
      <input type="radio" name={name} value={value} checked={selected} disabled={disabled} onChange={() => onSelect(value)} />
      <span className={ui.optionIcon}>{icon}</span>
      <span>
        <span className={ui.optionTitle}>
          {title}
          {pill && <span className={ui.optionPill}>{pill}</span>}
        </span>
        <span className={ui.optionText} style={{ display: "block" }}>
          {text}
        </span>
      </span>
      <span className={ui.radio} aria-hidden="true" />
    </label>
  );
}

export default function NewJob() {
  const { active, remaining, planLabel, billingEnabled } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const initialType: JobType = params.get("type") === "META" ? "META" : "ALT_TEXT";
  const [type, setType] = useState<JobType>(initialType);
  const [mode, setMode] = useState<Mode>("ONLY_MISSING");
  const [confirmed, setConfirmed] = useState(false);

  const runningIds = Object.fromEntries(active.map((j) => [j.type, j.id]));
  const runningForType = runningIds[type];
  const submitting = fetcher.state !== "idle";
  const overwrite = mode === "OVERWRITE_ALL";
  const canStart = !runningForType && (!overwrite || confirmed) && !submitting;
  const noun = type === "ALT_TEXT" ? "image" : "product";
  const field = type === "ALT_TEXT" ? "alt text" : "meta title and description";

  const start = () => fetcher.submit({ type, mode, confirmOverwrite: confirmed ? "yes" : "no" }, { method: "POST" });

  return (
    <s-page heading="New bulk job">
      <s-section heading="1. What should BulkFlow write?">
        <fieldset className={ui.options} aria-label="What to write">
          <Option
            name="type"
            value="ALT_TEXT"
            selected={type === "ALT_TEXT"}
            onSelect={setType}
            icon={<IImage />}
            title="Image alt text"
            text="Looks at each product photo and describes what it shows, for screen readers and image search."
          />
          <Option
            name="type"
            value="META"
            selected={type === "META"}
            onSelect={setType}
            icon={<ISearch />}
            title="Meta titles & descriptions"
            text="Writes the title and description shown in search results, from each product's own details."
          />
        </fieldset>
        {runningForType && (
          <div className={ui.fadeIn} style={{ marginTop: 12 }}>
            <s-banner tone="info" heading="A job like this is already running">
              Only one {type === "ALT_TEXT" ? "alt text" : "meta tag"} job runs at a time. <s-link href={`/app/jobs/${runningForType}`}>Watch it live</s-link>
            </s-banner>
          </div>
        )}
      </s-section>

      <s-section heading="2. Which items should it include?">
        <fieldset className={ui.options} aria-label="Which items">
          <Option
            name="mode"
            value="ONLY_MISSING"
            selected={mode === "ONLY_MISSING"}
            onSelect={(v) => {
              setMode(v);
              setConfirmed(false);
            }}
            icon={<IFill />}
            title="Only fill what's missing"
            pill="Recommended"
            text={`Only ${noun}s with no ${field}. Anything you've already written stays exactly as it is.`}
          />
          <Option
            name="mode"
            value="OVERWRITE_ALL"
            selected={overwrite}
            onSelect={setMode}
            warn
            icon={<IRewrite />}
            title="Rewrite everything"
            text={`Every ${noun}, replacing the ${field} that's there now. Previous values are saved in the job history.`}
          />
        </fieldset>
        {overwrite && (
          <div className={ui.fadeIn} style={{ marginTop: 12 }}>
            <s-banner tone="warning" heading="This replaces existing values">
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginTop: 4 }}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.currentTarget.checked)} style={{ marginTop: 3 }} />
                <span>
                  I understand every {noun}&apos;s {field} will be rewritten, including ones I wrote myself.
                </span>
              </label>
            </s-banner>
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="What happens next">
        <s-stack direction="block" gap="base">
          <ul className={ui.summary}>
            <li className={ui.summaryItem}>
              <span className={ui.summaryDot}>
                <IEye size={13} />
              </span>
              <span>
                BulkFlow scans your catalog and finds every {noun} {overwrite ? "to rewrite" : `missing ${field}`}.
              </span>
            </li>
            <li className={ui.summaryItem}>
              <span className={ui.summaryDot}>
                <ICheck size={13} />
              </span>
              <span>Each new value is written to Shopify and read back to confirm it saved. You can watch it live.</span>
            </li>
            <li className={ui.summaryItem}>
              <span className={ui.summaryDot}>
                <IShield size={13} />
              </span>
              <span>Anything that can&apos;t be updated is listed with the reason, and you can retry it in one click.</span>
            </li>
          </ul>
          {billingEnabled && (
            <div className={ui.allowance}>
              <strong>{remaining.toLocaleString()}</strong> items left this period on your {planLabel} plan, including credits. Only verified updates count. If the job needs more it pauses and waits; nothing is lost.{" "}
              <a className={ui.link} href="/app/billing">
                Plans & credits
              </a>
            </div>
          )}
          {fetcher.data?.error && (
            <div className={ui.fadeIn}>
              <s-banner tone="critical">{fetcher.data.error}</s-banner>
            </div>
          )}
          <s-button variant="primary" tone={overwrite ? "critical" : undefined} disabled={!canStart || undefined} loading={submitting || undefined} onClick={start}>
            {overwrite ? `Rewrite all ${field}` : `Start filling in ${field}`}
          </s-button>
          <s-text color="subdued">Jobs keep running if you close this page.</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
