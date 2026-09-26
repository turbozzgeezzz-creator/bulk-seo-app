export const JOB_TYPE_LABEL: Record<string, string> = {
  ALT_TEXT: "Image alt text",
  META: "Meta titles & descriptions",
};

export const MODE_LABEL: Record<string, string> = {
  ONLY_MISSING: "Only fill in what's missing",
  OVERWRITE_ALL: "Rewrite everything",
};

type Tone = "info" | "success" | "warning" | "critical" | "neutral";

export const STATUS_DISPLAY: Record<string, { label: string; tone: Tone }> = {
  SCANNING: { label: "Scanning catalog", tone: "info" },
  RUNNING: { label: "Running", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  COMPLETED_WITH_ERRORS: { label: "Completed with errors", tone: "warning" },
  FAILED: { label: "Stopped", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function unitFor(type: string, n: number) {
  if (type === "ALT_TEXT") return n === 1 ? "image" : "images";
  return n === 1 ? "product" : "products";
}
