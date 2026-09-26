/** Accessible determinate progress bar (Polaris web components don't ship one). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      style={{ height: 8, borderRadius: 4, background: "var(--p-color-bg-fill-tertiary, #e3e3e3)", overflow: "hidden" }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: "var(--p-color-bg-fill-brand, #303030)",
          transition: "width 400ms ease",
        }}
      />
    </div>
  );
}
