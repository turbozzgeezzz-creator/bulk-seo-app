import type { ReactNode } from "react";
import styles from "./billing.module.css";
import { useMounted, useTweened } from "./hooks";
import { ICheck } from "./icons";
import type { CreditPack, Plan } from "../../lib/billing/plans";

export { styles as billingUi };

export interface UsageLike {
  plan: string;
  planLabel: string;
  included: number;
  used: number;
  creditsUsed: number;
  creditBalance: number;
  remaining: number;
  periodStart: Date | string;
  periodEnd: Date | string;
}

const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric" });

export function UsageMeter({ usage, compact = false }: { usage: UsageLike; compact?: boolean }) {
  const mounted = useMounted();
  const includedUsed = Math.min(usage.used, usage.included);
  const ratio = usage.included > 0 ? includedUsed / usage.included : 1;
  const animated = useTweened(includedUsed);
  const tone = ratio >= 1 ? (usage.creditBalance > 0 ? styles.meterCredits : styles.meterFull) : ratio >= 0.8 ? styles.meterWarn : "";
  // eslint-disable-next-line react-hooks/purity -- display-only, browser-only (after mount)
  const daysLeft = mounted ? Math.max(0, Math.ceil((new Date(usage.periodEnd).getTime() - Date.now()) / 86_400_000)) : null;
  return (
    <div className={`${styles.usage} ${compact ? styles.usageCompact : ""}`}>
      <div className={styles.usageHead}>
        <div>
          <div className={styles.usageEyebrow}>Current plan</div>
          <div className={styles.usagePlan}>
            {usage.planLabel}
            <span className={styles.usagePlanItems}>{usage.included.toLocaleString()} items / 30 days</span>
          </div>
        </div>
        <div className={styles.usageRemaining}>
          <span className={styles.usageRemainingValue}>{usage.remaining.toLocaleString()}</span>
          <span className={styles.usageRemainingLabel}>items left</span>
        </div>
      </div>
      <div className={styles.meter} role="img" aria-label={`${includedUsed} of ${usage.included} included items used`}>
        <div className={`${styles.meterFill} ${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className={styles.usageFoot}>
        <span>
          <strong>{animated.toLocaleString()}</strong> of {usage.included.toLocaleString()} included items used
        </span>
        <span>
          <strong>{usage.creditBalance.toLocaleString()}</strong> credits
          {usage.creditsUsed > 0 ? ` · ${usage.creditsUsed.toLocaleString()} used this period` : ""}
        </span>
        <span>
          Resets {fmtDate(usage.periodEnd)}
          {daysLeft != null ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : ""}
        </span>
      </div>
    </div>
  );
}

export function PlanCard({ plan, current, children }: { plan: Plan; current: boolean; children?: ReactNode }) {
  const perItem = plan.monthlyPrice > 0 ? plan.monthlyPrice / plan.includedItems : 0;
  return (
    <div className={`${styles.plan} ${plan.highlight ? styles.planHighlight : ""} ${current ? styles.planCurrent : ""}`}>
      {plan.highlight && !current && <span className={styles.planFlag}>Most popular</span>}
      {current && <span className={`${styles.planFlag} ${styles.planFlagCurrent}`}>Your plan</span>}
      <div className={styles.planName}>{plan.label}</div>
      <div className={styles.planPrice}>
        ${plan.monthlyPrice}
        <span className={styles.planPer}>{plan.monthlyPrice === 0 ? "forever" : "/ 30 days"}</span>
      </div>
      <div className={styles.planItems}>
        <strong>{plan.includedItems.toLocaleString()}</strong> items included
      </div>
      <p className={styles.planBlurb}>{plan.blurb}</p>
      <ul className={styles.planFeatures}>
        {[
          perItem > 0 ? `About ${(perItem * 100).toFixed(1)}¢ per item` : "No card needed",
          "Alt text and meta tags",
          "Every change verified in your store",
        ].map((f) => (
          <li key={f}>
            <ICheck size={14} /> {f}
          </li>
        ))}
      </ul>
      <div className={styles.planAction}>{current ? <span className={styles.currentNote}>Current plan</span> : children}</div>
    </div>
  );
}

export function CreditPackCard({ pack, children }: { pack: CreditPack; children?: ReactNode }) {
  return (
    <div className={styles.pack}>
      <div className={styles.packCredits}>
        {pack.credits.toLocaleString()}
        <span>credits</span>
      </div>
      <div className={styles.packPrice}>
        ${pack.price} <span>· {((pack.price / pack.credits) * 100).toFixed(1)}¢ each</span>
      </div>
      {children}
    </div>
  );
}
