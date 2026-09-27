import { useEffect, useState } from "react";
import styles from "./marketing.module.css";

/**
 * A looping, clearly-labelled illustration of a bulk job on the landing
 * page. Sample data only; it doesn't claim real customer numbers. One
 * setInterval at 900 ms drives it; the bar animates via transform.
 */

const SAMPLE = [
  { name: "Linen overshirt, sand", alt: "Sand-colored linen overshirt with chest pocket, folded on oak table", hue: 28 },
  { name: "Ceramic pour-over set", alt: "Matte white ceramic pour-over dripper and carafe beside coffee beans", hue: 200 },
  { name: "Trail running shoe", alt: "Charcoal trail running shoe with orange lugged sole, side view", hue: 12 },
  { name: "Walnut desk organizer", alt: "Walnut wood desk organizer holding pens and a phone", hue: 34 },
  { name: "Merino beanie, forest", alt: "Forest green ribbed merino beanie on a light grey background", hue: 140 },
  { name: "Brass table lamp", alt: "Brushed brass table lamp with white linen shade, lit", hue: 45 },
  { name: "Canvas weekender bag", alt: "Olive canvas weekender bag with tan leather handles", hue: 80 },
];

const TOTAL = 500;

type Row = { key: number; name: string; alt: string; hue: number; state: "working" | "ok" | "fail" };

function initialRows(): Row[] {
  return SAMPLE.slice(0, 3).map((s, i) => ({ key: i, ...s, state: i === 0 ? "working" : "ok" }));
}

export function LivePreview() {
  const [done, setDone] = useState(142);
  const [rows, setRows] = useState<Row[]>(initialRows);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let n = 3;
    const t = setInterval(() => {
      setDone((d) => (d >= TOTAL ? 60 : d + 7 + Math.floor(Math.random() * 6)));
      setRows((prev) => {
        const s = SAMPLE[n % SAMPLE.length];
        const settled = prev.map((r, i) => (i === 0 ? { ...r, state: n % 9 === 0 ? ("fail" as const) : ("ok" as const) } : r));
        n += 1;
        return [{ key: n, ...s, state: "working" as const }, ...settled].slice(0, 3);
      });
    }, 900);
    return () => clearInterval(t);
  }, []);

  const shown = Math.min(done, TOTAL);
  return (
    <div className={`${styles.card} ${styles.preview}`}>
      <div className={styles.previewHead}>
        <div className={styles.previewTitle}>
          <span className={styles.pulseDot} aria-hidden="true" />
          Image alt text · Running
        </div>
        <span className={styles.previewTag}>Preview · sample data</span>
      </div>
      <div className={styles.previewCount} aria-live="off">
        {shown.toLocaleString()} <span>of {TOTAL} images processed</span>
      </div>
      <div className={styles.track} role="img" aria-label={`Illustration: ${shown} of ${TOTAL} images processed`}>
        <div className={styles.fill} style={{ transform: `scaleX(${shown / TOTAL})` }} />
      </div>
      <ul className={styles.rows}>
        {rows.map((r) => (
          <li key={r.key} className={styles.row}>
            <span
              className={styles.thumb}
              style={{ background: `linear-gradient(135deg, hsl(${r.hue} 45% 62%), hsl(${r.hue + 20} 35% 28%))` }}
              aria-hidden="true"
            />
            <span className={styles.rowText}>
              <span className={styles.rowName} style={{ display: "block" }}>
                {r.name}
              </span>
              <span className={styles.rowAlt} style={{ display: "block" }}>
                {r.state === "fail" ? "Image returned HTTP 404 (may have been deleted)" : r.state === "working" ? "Analysing photo…" : `“${r.alt}”`}
              </span>
            </span>
            <span className={`${styles.status} ${r.state === "ok" ? styles.statusOk : r.state === "fail" ? styles.statusFail : styles.statusWorking}`}>
              {r.state === "working" ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" /> Writing
                </>
              ) : r.state === "ok" ? (
                "Verified"
              ) : (
                "Needs attention"
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
