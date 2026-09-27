import { useEffect, useRef, type ReactNode } from "react";
import styles from "./marketing.module.css";

export const marketingLinks = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" as const },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" },
];

/** Flowing strokes that echo the ribbon in the BulkFlow mark. Decorative only. */
function Ribbons() {
  const paths = [
    "M-100 520 C 220 420, 360 140, 700 190 S 1180 470, 1700 250",
    "M-100 600 C 260 520, 420 260, 760 300 S 1220 560, 1700 360",
    "M-100 680 C 300 620, 480 380, 820 410 S 1260 650, 1700 470",
    "M-100 440 C 180 330, 320 60, 640 90 S 1140 380, 1700 140",
  ];
  return (
    <svg className={styles.ribbons} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <defs>
        <linearGradient id="bf-ribbon" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#0b3ee6" />
          <stop offset="0.5" stopColor="#1673ff" />
          <stop offset="1" stopColor="#29b6ff" />
        </linearGradient>
      </defs>
      {paths.map((d) => (
        <path key={`g${d}`} d={d} className={styles.ribbonGlow} stroke="url(#bf-ribbon)" />
      ))}
      {paths.map((d) => (
        <path key={`l${d}`} d={d} className={styles.ribbonLine} stroke="url(#bf-ribbon)" />
      ))}
    </svg>
  );
}

export function Backdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={styles.grid} />
      <div className={`${styles.orb} ${styles.orbA}`} />
      <div className={`${styles.orb} ${styles.orbB}`} />
      <div className={`${styles.orb} ${styles.orbC}`} />
      <Ribbons />
    </div>
  );
}

export function Brand() {
  return (
    <a href="/" className={styles.brand} aria-label="BulkFlow home">
      <img src="/brand/bulkflow-mark.png" alt="" width={34} height={27} />
      <span>
        Bulk<span className={styles.brandFlow}>Flow</span>
      </span>
    </a>
  );
}

/**
 * Adds `revealed` to every `.reveal` element as it scrolls into view, and
 * feeds the pointer position to feature cards for their hover highlight.
 * One IntersectionObserver for the page; nothing runs per frame.
 */
function usePageEffects(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(`.${styles.reveal}`));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let observer: IntersectionObserver | null = null;
    if (!reduce && "IntersectionObserver" in window) {
      el.classList.add(styles.jsReady);
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add(styles.revealed);
              observer?.unobserve(e.target);
            }
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
      );
      items.forEach((i) => observer!.observe(i));
    }

    const onMove = (ev: PointerEvent) => {
      const card = (ev.target as HTMLElement).closest<HTMLElement>(`.${styles.feature}`);
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      card.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      observer?.disconnect();
      el.removeEventListener("pointermove", onMove);
    };
  }, [root]);
}

export function MarketingLayout({ children, navCta = true }: { children: ReactNode; navCta?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  usePageEffects(root);
  return (
    <div className={styles.page} ref={root}>
      <Backdrop />
      <div className={styles.shell}>
        <header className={styles.nav}>
          <Brand />
          <nav className={styles.navLinks} aria-label="Main">
            <a className={styles.navLink} href="/#features">
              Features
            </a>
            <a className={styles.navLink} href="/#how">
              How it works
            </a>
            <a className={styles.navLink} href="/privacy">
              Privacy
            </a>
            {navCta && (
              <a className={styles.navCta} href="/#install">
                Log in
              </a>
            )}
          </nav>
        </header>
        <main>{children}</main>
        <footer className={styles.footer}>
          <span>© {new Date().getFullYear()} BulkFlow</span>
          <span>
            <a href="/privacy">Privacy policy</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
