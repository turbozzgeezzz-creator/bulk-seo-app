import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ACTIVE_STATUSES } from "../lib/jobs/runner.server";
import { STATUS_DISPLAY } from "../components/jobDisplay";
import { EmptyState, JobProgress } from "../components/JobProgress";
import { Hero, JobRow, POLL_MS, RelativeTime, SafetyList, StatTile, ToolTile, ui } from "../components/app/AppUi";
import { ICheck, IImage, ISearch, IStack } from "../components/app/icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [active, recent, totals, byType, last] = await Promise.all([
    prisma.bulkJob.findMany({ where: { shop, status: { in: [...ACTIVE_STATUSES] } }, orderBy: { createdAt: "asc" } }),
    prisma.bulkJob.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.bulkJob.aggregate({ where: { shop }, _sum: { succeeded: true }, _count: { _all: true } }),
    prisma.bulkJob.groupBy({ by: ["type"], where: { shop }, _sum: { succeeded: true } }),
    prisma.bulkJob.findFirst({ where: { shop, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
  ]);
  const sumFor = (t: string) => byType.find((g) => g.type === t)?._sum.succeeded ?? 0;
  return {
    active,
    recent,
    stats: {
      itemsUpdated: totals._sum.succeeded ?? 0,
      jobsRun: totals._count._all,
      altTextUpdated: sumFor("ALT_TEXT"),
      metaUpdated: sumFor("META"),
      lastRunAt: last?.finishedAt ?? null,
    },
  };
};

export default function Dashboard() {
  const { active, recent, stats } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const firstRun = recent.length === 0;

  // Keep the "Running now" card live while a job is going.
  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => revalidator.state === "idle" && revalidator.revalidate(), POLL_MS);
    return () => clearInterval(t);
  }, [active.length, revalidator]);

  return (
    <s-page heading="BulkFlow">
      <Hero firstRun={firstRun} />

      {!firstRun && (
        <div className={ui.stats} style={{ marginBottom: 16 }}>
          <StatTile icon={<ICheck size={14} />} tone="ok" label="Items updated" value={stats.itemsUpdated} hint="Verified in your store" />
          <StatTile icon={<IImage size={14} />} label="Alt text" value={stats.altTextUpdated} />
          <StatTile icon={<ISearch size={14} />} label="Meta tags" value={stats.metaUpdated} />
          <StatTile
            icon={<IStack size={14} />}
            tone="muted"
            label="Jobs run"
            value={stats.jobsRun}
            hint={
              stats.lastRunAt ? (
                <>
                  Last finished <RelativeTime date={stats.lastRunAt} />
                </>
              ) : undefined
            }
          />
        </div>
      )}

      {active.map((job) => (
        <s-section key={job.id} heading="Running now">
          <div className={ui.fadeIn}>
            <s-stack direction="block" gap="base">
              <JobProgress compact {...job} />
              <s-stack direction="inline" gap="base">
                <s-button variant="primary" href={`/app/jobs/${job.id}`}>
                  Watch live
                </s-button>
              </s-stack>
            </s-stack>
          </div>
        </s-section>
      ))}

      <s-section heading={firstRun ? "What would you like to fix first?" : "Start a job"}>
        <div className={ui.tools}>
          <ToolTile type="ALT_TEXT" />
          <ToolTile type="META" />
        </div>
      </s-section>

      <s-section heading="Recent jobs">
        {firstRun ? (
          <EmptyState title="Your first job will show up here">
            Every job keeps a full record: what changed, before and after, and the reason for anything that couldn&apos;t be updated.
          </EmptyState>
        ) : (
          <>
            <div className={ui.jobList}>
              {recent.map((job) => (
                <JobRow key={job.id} job={job} badge={<s-badge tone={STATUS_DISPLAY[job.status]?.tone}>{STATUS_DISPLAY[job.status]?.label ?? job.status}</s-badge>} />
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <a className={ui.link} href="/app/jobs">
                View all jobs →
              </a>
            </div>
          </>
        )}
      </s-section>

      <s-section slot="aside" heading="Built to be safe">
        <SafetyList />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
