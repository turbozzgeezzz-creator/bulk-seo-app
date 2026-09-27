import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./embedded.module.css";
import { unitFor } from "./jobDisplay";
import { estimateJob, formatMinutesLeft } from "./jobProgressMath";

/**
 * Animates a number towards its new value whenever the job page's 2 s poll
 * brings fresh counts, so "142 → 150" counts up rather than jumping. One
 * requestAnimationFrame loop for ~600 ms per update, then nothing.
 */
function useTweened(value: number, durationMs = 600): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    // Reduced motion: same path, zero duration, so it lands on the first frame.
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : durationMs;
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = duration === 0 ? 1 : Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(origin + (value - origin) * eased);
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, durationMs]);
  return shown;
}

export interface JobProgressProps {
  type: string;
  status: string;
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  scanned: number;
  startedAt?: Date | string | null;
  /** Smaller variant for the dashboard cards. */
  compact?: boolean;
}

const noopSubscribe = () => () => {};

const pct = (n: number, d: number) => (d > 0 ? `${Math.min(100, (n / d) * 100)}%` : "0%");

export function JobProgress(p: JobProgressProps) {
  const scanning = p.status === "SCANNING";
  const running = p.status === "RUNNING";
  const finished = p.status === "COMPLETED" || p.status === "COMPLETED_WITH_ERRORS";
  const shown = useTweened(p.processed);
  const total = Math.max(p.total, 0);
  const percent = total > 0 ? Math.floor((p.processed / total) * 100) : finished ? 100 : 0;

  // Clock-dependent, so browser-only (after mount) to keep server and client
  // HTML identical. Recomputed on each poll re-render; no timer of its own.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const estimate = running && mounted ? estimateJob(p.processed, total, p.startedAt) : null;

  const unit = unitFor(p.type, total);
  const className = `${styles.progress} ${running ? styles.running : ""} ${scanning ? styles.scanning : ""}`;

  return (
    <div className={className}>
      <div className={styles.progressTop}>
        <div className={`${styles.count} ${p.compact ? styles.countSmall : ""}`}>
          {scanning ? (
            <>
              {p.scanned.toLocaleString()}
              <span className={styles.countOf}>{unitFor(p.type, p.scanned)} scanned · {p.total.toLocaleString()} need work so far</span>
            </>
          ) : (
            <>
              {shown.toLocaleString()}
              <span className={styles.countOf}>
                of {total.toLocaleString()} {unit} processed
              </span>
            </>
          )}
        </div>
        <div className={styles.meta}>
          {finished && p.failed === 0 ? (
            <span className={styles.done}>
              <span className={styles.checkCircle} aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path className={styles.checkPath} d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              Done
            </span>
          ) : (
            <>
              {!scanning && <span className={styles.metaStrong}>{percent}%</span>}
              {estimate && (
                <>
                  <span>{Math.round(estimate.perMinute)}/min</span>
                  <span>{formatMinutesLeft(estimate.minutesLeft)}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div
        className={`${styles.track} ${p.compact ? styles.trackSmall : ""}`}
        role="progressbar"
        aria-label={scanning ? "Scanning catalog" : "Job progress"}
        aria-valuemin={0}
        aria-valuemax={scanning ? undefined : Math.max(total, 1)}
        aria-valuenow={scanning ? undefined : p.processed}
        aria-valuetext={scanning ? `Scanning, ${p.scanned} checked` : `${p.processed} of ${total} ${unit} processed`}
      >
        {!scanning && (
          <>
            <div className={`${styles.seg} ${styles.segOk}`} style={{ width: pct(p.succeeded, total) }} />
            <div className={`${styles.seg} ${styles.segFail}`} style={{ width: pct(p.failed, total) }} />
            <div className={`${styles.seg} ${styles.segSkip}`} style={{ width: pct(p.skipped, total) }} />
          </>
        )}
      </div>

      {!p.compact && !scanning && (
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: "#1673ff" }} /> {p.succeeded.toLocaleString()} updated
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: "var(--p-color-bg-fill-critical, #e51c00)" }} /> {p.failed.toLocaleString()} failed
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: "var(--p-color-bg-fill-disabled, #b5b5b5)" }} /> {p.skipped.toLocaleString()} skipped
          </span>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyArt} aria-hidden="true">
        <img src="/brand/bulkflow-mark.png" alt="" width={44} height={35} />
      </div>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyText}>{children}</div>
    </div>
  );
}

export const fadeIn = styles.fadeIn;
