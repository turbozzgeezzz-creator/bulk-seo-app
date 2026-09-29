import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import styles from "./app.module.css";
import { useMounted, useTweened } from "./hooks";
import { IAlert, IArrow, ICheck, IImage, IPause, ISearch, IShield, ISkip, IStack, IStop } from "./icons";
import { JOB_TYPE_LABEL, MODE_LABEL, unitFor } from "../jobDisplay";
import { estimateJob, formatMinutesLeft } from "../jobProgressMath";

export { styles as ui };

export const POLL_MS = 2000;

export interface JobLike {
  id: string;
  type: string;
  mode: string;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  scanned: number;
  scanComplete: boolean;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  error?: string | null;
}

export const isActive = (status: string) => status === "SCANNING" || status === "RUNNING";

export function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  return type === "ALT_TEXT" ? <IImage size={size} /> : <ISearch size={size} />;
}

// ---------------------------------------------------------------- time

function relative(date: Date, now: number): string {
  const s = Math.round((now - date.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "3 min ago". Browser-only (it depends on the clock), so SSR and hydration match. */
export function RelativeTime({ date }: { date: Date | string | null | undefined }) {
  const mounted = useMounted();
  if (!date || !mounted) return null;
  const d = new Date(date);
  // eslint-disable-next-line react-hooks/purity -- display-only; re-renders on every poll anyway
  return <time dateTime={d.toISOString()}>{relative(d, Date.now())}</time>;
}

export function duration(from: Date | string | null | undefined, to: Date | string | null | undefined): string | null {
  if (!from || !to) return null;
  const min = (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
  if (!Number.isFinite(min) || min < 0) return null;
  if (min < 1) return "under a minute";
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
}

// ---------------------------------------------------------------- dashboard

function Ribbon() {
  return (
    <svg className={styles.heroRibbon} viewBox="0 0 520 260" aria-hidden="true">
      <defs>
        <linearGradient id="bf-hero-ribbon" x1="0" x2="1">
          <stop offset="0" stopColor="#8fd8ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#8fd8ff" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <path d="M-20 220 C 120 200, 160 60, 300 70 S 470 190, 560 120" stroke="rgba(255,255,255,.12)" strokeWidth="26" />
      <path className={styles.heroRibbonLine} d="M-20 220 C 120 200, 160 60, 300 70 S 470 190, 560 120" stroke="url(#bf-hero-ribbon)" />
      <path className={styles.heroRibbonLine} d="M-20 250 C 140 230, 200 100, 330 110 S 480 220, 560 160" stroke="url(#bf-hero-ribbon)" />
    </svg>
  );
}

export function Hero({ firstRun }: { firstRun: boolean }) {
  return (
    <div className={styles.hero}>
      <Ribbon />
      <div className={styles.heroInner}>
        <span className={styles.heroEyebrow}>
          <img src="/brand/bulkflow-mark.png" alt="" width={22} height={17} />
          BULKFLOW
        </span>
        <h2 className={styles.heroTitle}>{firstRun ? "Give every product the SEO it's missing." : "Keep your catalog's SEO complete."}</h2>
        <p className={styles.heroText}>
          {firstRun
            ? "BulkFlow looks at each product photo and product page, then writes the image alt text, meta titles and meta descriptions that are missing. You watch it happen live, and every change is checked in your store before it counts."
            : "Run a job whenever you add products. By default BulkFlow only fills in what's missing, so anything you've written yourself stays exactly as it is."}
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.heroButton} to="/app/new">
            {firstRun ? "Start your first job" : "Start a new job"} <IArrow />
          </Link>
          <Link className={styles.heroLink} to="/app/jobs">
            View job history
          </Link>
        </div>
        {firstRun && (
          <ol className={styles.steps}>
            {[
              ["Choose what to fix", "Alt text, or meta titles and descriptions."],
              ["Watch it run", "Live progress, product by product."],
              ["Review every change", "Before and after, and why anything failed."],
            ].map(([title, text], i) => (
              <li key={title} className={styles.step}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span className={styles.stepTitle}>{title}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

type Tone = "brand" | "ok" | "warn" | "muted";

export function StatTile({ icon, tone = "brand", label, value: raw, hint }: { icon: ReactNode; tone?: Tone; label: string; value: number | string | null | undefined; hint?: ReactNode }) {
  const value = raw ?? 0;
  const toneClass = tone === "ok" ? styles.statIconOk : tone === "warn" ? styles.statIconWarn : tone === "muted" ? styles.statIconMuted : "";
  const animated = useTweened(typeof value === "number" ? value : 0);
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>
        <span className={`${styles.statIcon} ${toneClass}`}>{icon}</span>
        {label}
      </span>
      <span className={styles.statValue}>{typeof value === "number" ? animated.toLocaleString() : value}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}

export function ToolTile({ type }: { type: "ALT_TEXT" | "META" }) {
  return (
    <Link className={styles.tool} to={`/app/new?type=${type}`}>
      <span className={styles.toolIcon}>
        <TypeIcon type={type} size={20} />
      </span>
      <span>
        <span className={styles.toolTitle} style={{ display: "block" }}>
          {JOB_TYPE_LABEL[type]}
        </span>
        <span className={styles.toolText} style={{ display: "block" }}>
          {type === "ALT_TEXT"
            ? "Describes what each product photo actually shows, for screen readers and image search."
            : "Search-result titles and descriptions written from each product's own details."}
        </span>
        <span className={styles.toolCta}>
          Set up job <IArrow size={14} />
        </span>
      </span>
    </Link>
  );
}

export function SafetyList() {
  const items = [
    ["Only fills what's missing", "Unless you choose to rewrite, anything that already has a value is left alone."],
    ["Verified in your store", "An item counts as updated only after Shopify returns the new value."],
    ["Never blank, never filler", "Empty or generic text is rejected, never written."],
    ["Every change on record", "Previous values are kept in each job's history."],
  ];
  return (
    <ul className={styles.safety}>
      {items.map(([title, text]) => (
        <li key={title} className={styles.safetyItem}>
          <span className={styles.safetyIcon}>
            <IShield />
          </span>
          <span>
            <span className={styles.safetyTitle}>{title}</span>
            <br />
            <span style={{ color: "var(--bf-muted)" }}>{text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- job rows

const pct = (n: number, d: number) => (d > 0 ? `${Math.min(100, (n / d) * 100)}%` : "0%");

export function MiniBar({ job }: { job: JobLike }) {
  return (
    <div className={styles.miniBar} aria-hidden="true">
      <div className={styles.miniOk} style={{ width: pct(job.succeeded, job.total) }} />
      <div className={styles.miniFail} style={{ width: pct(job.failed, job.total) }} />
      <div className={styles.miniSkip} style={{ width: pct(job.skipped, job.total) }} />
    </div>
  );
}

export function JobRow({ job, badge }: { job: JobLike; badge: ReactNode }) {
  const unit = unitFor(job.type, job.total);
  const counts = isActive(job.status)
    ? job.status === "SCANNING"
      ? `Scanning catalog · ${job.scanned.toLocaleString()} checked`
      : `${job.processed.toLocaleString()} of ${job.total.toLocaleString()} ${unit}`
    : job.total === 0
      ? "Nothing needed updating"
      : `${job.succeeded.toLocaleString()} updated${job.failed ? ` · ${job.failed.toLocaleString()} failed` : ""}${job.skipped ? ` · ${job.skipped.toLocaleString()} skipped` : ""}`;
  return (
    <Link className={styles.jobRow} to={`/app/jobs/${job.id}`}>
      <span className={styles.jobIcon}>
        <TypeIcon type={job.type} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className={styles.jobTitle} style={{ display: "block" }}>
          {JOB_TYPE_LABEL[job.type]}
        </span>
        <span className={styles.jobSub} style={{ display: "block" }}>
          {MODE_LABEL[job.mode]} · <RelativeTime date={job.createdAt} />
        </span>
        <span className={styles.jobCounts} style={{ display: "block" }}>
          {counts}
        </span>
      </span>
      <span className={styles.miniBarWrap}>
        <MiniBar job={job} />
      </span>
      <span className={styles.jobBadge}>{badge}</span>
    </Link>
  );
}

// ---------------------------------------------------------------- live job

export function ProgressRing({ value, max, active }: { value: number; max: number; active: boolean }) {
  const size = 148;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const percent = useTweened(Math.floor(ratio * 100), POLL_MS - 100, true);
  return (
    <div className={styles.ring} role="img" aria-label={`${Math.floor(ratio * 100)}% complete`}>
      {active && <div className={styles.ringGlow} />}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="bf-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0b3ee6" />
            <stop offset="0.6" stopColor="#1673ff" />
            <stop offset="1" stopColor="#29b6ff" />
          </linearGradient>
        </defs>
        <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className={styles.ringValue}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke="url(#bf-ring)"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
        />
      </svg>
      <div className={styles.ringCenter}>
        <div>
          <div className={styles.ringPct}>{percent}%</div>
          <div className={styles.ringSub}>{active ? "Complete" : "Done"}</div>
        </div>
      </div>
    </div>
  );
}

export function LivePanel({ job }: { job: JobLike }) {
  const scanning = job.status === "SCANNING";
  const mounted = useMounted();
  const processed = useTweened(job.processed, POLL_MS - 100, true);
  const estimate = mounted && !scanning ? estimateJob(job.processed, job.total, job.startedAt) : null;
  const unit = unitFor(job.type, job.total);
  return (
    <div className={styles.live}>
      <ProgressRing value={scanning ? 0 : job.processed} max={Math.max(job.total, 1)} active />
      <div style={{ minWidth: 0 }}>
        <div className={styles.liveHead}>
          <span className={styles.livePulse} aria-hidden="true" />
          {scanning ? "Scanning your catalog" : "Live · updating every 2 seconds"}
        </div>
        {scanning ? (
          <div className={styles.liveCount}>
            {job.scanned.toLocaleString()}
            <span className={styles.liveCountOf}>
              {unitFor(job.type, job.scanned)} checked · {job.total.toLocaleString()} need work so far
            </span>
          </div>
        ) : (
          <div className={styles.liveCount} aria-live="polite" aria-atomic="true">
            {processed.toLocaleString()}
            <span className={styles.liveCountOf}>
              of {job.total.toLocaleString()} {unit} done
            </span>
          </div>
        )}
        <div className={styles.liveMeta}>
          {estimate ? (
            <>
              <span>
                <strong>{Math.round(estimate.perMinute)}</strong> {unitFor(job.type, 2)} a minute
              </span>
              <span>
                <strong>{formatMinutesLeft(estimate.minutesLeft).replace(" left", "")}</strong> left
              </span>
            </>
          ) : (
            <span>{scanning ? "Working out which items need updating…" : "Measuring speed…"}</span>
          )}
          <span>Keeps running if you close this page</span>
        </div>
      </div>
    </div>
  );
}

export function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  if (src) return <s-thumbnail src={src} alt={alt} size="small" />;
  return (
    <span className={styles.jobIcon} style={{ width: 40, height: 40 }} aria-hidden="true">
      <IStack />
    </span>
  );
}

export interface FeedItem {
  id: string;
  label: string;
  imageUrl?: string | null;
  after: unknown;
  updatedAt: Date | string;
  fresh?: boolean;
}

function afterText(v: unknown): string {
  if (typeof v === "string") return v;
  const seo = (v ?? {}) as { title?: string | null; description?: string | null };
  return [seo.title, seo.description].filter(Boolean).join(" — ");
}

export function ActivityFeed({ items }: { items: FeedItem[] }) {
  return (
    <ul className={styles.feed}>
      {items.map((it) => (
        <li key={it.id} className={`${styles.feedItem} ${it.fresh ? styles.feedNew : ""}`}>
          <Thumb src={it.imageUrl} alt={it.label} />
          <span className={styles.feedText}>
            <span className={styles.feedName} style={{ display: "block" }}>
              {it.label}
            </span>
            <span className={styles.feedValue} style={{ display: "block" }}>
              “{afterText(it.after)}”
            </span>
          </span>
          <span className={styles.feedWhen}>
            <span className={styles.verified}>
              <ICheck size={14} /> Verified
            </span>
            <RelativeTime date={it.updatedAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- results

export function OutcomeHeader({ job }: { job: JobLike }) {
  const unit = (n: number) => unitFor(job.type, n);
  const took = duration(job.startedAt, job.finishedAt);
  let tone = styles.outcomeOk;
  let icon: ReactNode = (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className={styles.drawCheck} d="M20 6 9 17l-5-5" />
    </svg>
  );
  let title = `${job.succeeded.toLocaleString()} ${unit(job.succeeded)} updated`;
  if (job.status === "COMPLETED" && job.total === 0) title = "Everything already had a value";
  if (job.status === "COMPLETED_WITH_ERRORS") {
    tone = styles.outcomeWarn;
    icon = <IAlert size={26} />;
  }
  if (job.status === "FAILED") {
    tone = styles.outcomeBad;
    icon = <IAlert size={26} />;
    title = "This job stopped";
  }
  if (job.status === "PAUSED") {
    tone = styles.outcomeWarn;
    icon = <IPause size={24} />;
    title = `Paused at ${job.processed.toLocaleString()} of ${job.total.toLocaleString()}`;
  }
  if (job.status === "CANCELLED") {
    tone = styles.outcomeNeutral;
    icon = <IStop size={24} />;
    title = `Stopped after ${job.processed.toLocaleString()} of ${job.total.toLocaleString()}`;
  }
  return (
    <div className={styles.outcome}>
      <span className={`${styles.outcomeIcon} ${tone}`}>{icon}</span>
      <div>
        <div className={styles.outcomeTitle}>{title}</div>
        <div className={styles.outcomeText}>
          {JOB_TYPE_LABEL[job.type]} · {MODE_LABEL[job.mode]}
          {job.finishedAt ? (
            <>
              {" "}
              · finished <RelativeTime date={job.finishedAt} />
            </>
          ) : null}
          {took ? ` · took ${took}` : ""}
        </div>
      </div>
    </div>
  );
}

export function ResultStats({ job }: { job: JobLike }) {
  const leftAlone = job.scanComplete && job.mode === "ONLY_MISSING" ? Math.max(0, job.scanned - job.total) : 0;
  return (
    <div className={styles.stats}>
      <StatTile icon={<ICheck size={14} />} tone="ok" label="Updated & verified" value={job.succeeded} />
      <StatTile icon={<IAlert size={14} />} tone={job.failed ? "warn" : "muted"} label="Need attention" value={job.failed} />
      <StatTile icon={<ISkip size={14} />} tone="muted" label="Skipped" value={job.skipped} hint={job.skipped ? "Changed or removed during the job" : undefined} />
      {job.mode === "ONLY_MISSING" && (
        <StatTile icon={<IShield size={14} />} label="Left untouched" value={leftAlone} hint="Already had a value" />
      )}
    </div>
  );
}

export function isEmptyValue(v: unknown): boolean {
  return v == null || v === "";
}

function DiffLine({ kind, value }: { kind: "before" | "after"; value: unknown }) {
  const empty = isEmptyValue(value);
  return (
    <div className={`${styles.diffLine} ${kind === "before" ? styles.diffBefore : styles.diffAfter}`}>
      <span className={styles.diffTag}>{kind === "before" ? "Before" : "After"}</span>
      <span className={`${styles.diffValue} ${empty ? styles.diffEmpty : ""}`}>{empty ? "(empty)" : String(value)}</span>
    </div>
  );
}

/** Before → after for one item. Alt text is a string; meta is { title, description }. */
export function Diff({ before, after }: { before: unknown; after: unknown }) {
  if (typeof after === "string" || typeof before === "string" || after == null) {
    return (
      <div className={styles.diff}>
        <DiffLine kind="before" value={before} />
        <DiffLine kind="after" value={after} />
      </div>
    );
  }
  const b = (before ?? {}) as { title?: string | null; description?: string | null };
  const a = after as { title?: string | null; description?: string | null };
  return (
    <div className={styles.diff}>
      {(["title", "description"] as const).map((f) =>
        a[f] !== b[f] ? (
          <div key={f} style={{ display: "grid", gap: 4 }}>
            <span className={styles.diffField}>Meta {f}</span>
            <DiffLine kind="before" value={b[f]} />
            <DiffLine kind="after" value={a[f]} />
          </div>
        ) : null,
      )}
    </div>
  );
}

export function ReasonText({ children }: { children: ReactNode }) {
  return (
    <div className={styles.reason}>
      <IAlert size={14} />
      <span>{children}</span>
    </div>
  );
}

export function SectionHead({ title, count, bad, action }: { title: string; count?: number; bad?: boolean; action?: ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.sectionTitle}>
        {title}
        {count != null && <span className={`${styles.countPill} ${bad ? styles.countPillBad : ""}`}>{count.toLocaleString()}</span>}
      </span>
      {action}
    </div>
  );
}

export function productAdminUrl(productGid: string) {
  return `shopify://admin/products/${productGid.split("/").pop()}`;
}

// ---------------------------------------------------------------- results (grouped)

export interface FailureGroup {
  reason: string;
  count: number;
  items: { id: string; label: string; productId: string; imageUrl?: string | null }[];
}

/** Failures grouped by reason: one explanation per cause, not one row per item. */
export function FailureGroups({ groups, total }: { groups: FailureGroup[]; total: number }) {
  return (
    <div className={styles.groups}>
      {groups.map((g, i) => (
        <details key={g.reason} className={styles.group} open={i === 0 && groups.length === 1 && g.count <= 5}>
          <summary className={styles.groupSummary}>
            <span className={styles.groupCount}>{g.count.toLocaleString()}</span>
            <span className={styles.groupReason}>{g.reason}</span>
            <span className={styles.groupToggle}>{g.count === 1 ? "Show item" : "Show items"}</span>
          </summary>
          <ul className={styles.groupItems}>
            {g.items.map((it) => (
              <li key={it.id}>
                <Thumb src={it.imageUrl} alt={it.label} />
                <span className={styles.resultName}>{it.label}</span>
                <s-link href={productAdminUrl(it.productId)} target="_blank">
                  Open product
                </s-link>
              </li>
            ))}
            {g.count > g.items.length && <li className={styles.groupMore}>and {(g.count - g.items.length).toLocaleString()} more with the same reason</li>}
          </ul>
        </details>
      ))}
      {total > groups.reduce((n, g) => n + g.count, 0) && <span className={styles.groupMore}>Other, less common reasons are included when you retry.</span>}
    </div>
  );
}

export interface ChangeItem {
  id: string;
  label: string;
  productId: string;
  imageUrl?: string | null;
  before: unknown;
  after: unknown;
}

/** Alt text results as a gallery: each photo with the words now describing it. */
export function AltGallery({ items }: { items: ChangeItem[] }) {
  return (
    <ul className={styles.gallery}>
      {items.map((u) => (
        <li key={u.id} className={styles.galleryCard}>
          <a href={productAdminUrl(u.productId)} target="_blank" rel="noreferrer" className={styles.galleryImg}>
            {u.imageUrl ? <img src={u.imageUrl} alt={typeof u.after === "string" ? u.after : u.label} loading="lazy" /> : <IImage size={28} />}
            <span className={styles.galleryVerified}>
              <ICheck size={12} /> Verified
            </span>
          </a>
          <div className={styles.galleryBody}>
            <span className={styles.galleryLabel}>{u.label}</span>
            <span className={styles.galleryAlt}>{typeof u.after === "string" ? u.after : ""}</span>
            {!isEmptyValue(u.before) && <span className={styles.galleryWas}>Was: {String(u.before)}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Meta results the way a shopper meets them: as a search result. */
export function SerpPreview({ item, shop }: { item: ChangeItem; shop: string }) {
  const a = (item.after ?? {}) as { title?: string | null; description?: string | null };
  const b = (item.before ?? {}) as { title?: string | null; description?: string | null };
  // The store's myshopify address: its public domain isn't known here, and a made-up one would mislead.
  const domain = shop;
  return (
    <li className={styles.serpRow}>
      <div className={styles.serp}>
        <div className={styles.serpSite}>
          <span className={styles.serpFavicon} aria-hidden="true">
            {domain[0]?.toUpperCase()}
          </span>
          <span>
            <span className={styles.serpDomain}>{domain}</span>
            <span className={styles.serpPath}>› products</span>
          </span>
        </div>
        <div className={styles.serpTitle}>{a.title}</div>
        <div className={styles.serpDesc}>{a.description}</div>
      </div>
      <div className={styles.serpSide}>
        <span className={styles.resultName}>{item.label}</span>
        <span className={styles.serpMeta}>
          {a.title?.length ?? 0} / 60 title · {a.description?.length ?? 0} / 160 description
        </span>
        <span className={styles.serpMeta}>{isEmptyValue(b.title) && isEmptyValue(b.description) ? "Was empty before" : "Replaced earlier text"}</span>
        <s-link href={productAdminUrl(item.productId)} target="_blank">
          Open product
        </s-link>
      </div>
    </li>
  );
}

/** Shows the first `initial` children and a toggle for the rest. */
export function ShowMore<T>({ items, initial, render, noun }: { items: T[]; initial: number; render: (visible: T[]) => ReactNode; noun: string }) {
  const [all, setAll] = useState(false);
  const visible = all ? items : items.slice(0, initial);
  return (
    <>
      {render(visible)}
      {items.length > initial && (
        <button type="button" className={styles.showMore} onClick={() => setAll(!all)}>
          {all ? `Show fewer ${noun}` : `Show all ${items.length} ${noun}`}
        </button>
      )}
    </>
  );
}
