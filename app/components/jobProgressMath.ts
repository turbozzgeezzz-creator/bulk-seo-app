/** Throughput and time-left for a running job, from its real counters. Null until there's enough signal. */
export function estimateJob(
  processed: number,
  total: number,
  startedAt: Date | string | null | undefined,
  now: number = Date.now(),
): { perMinute: number; minutesLeft: number } | null {
  if (!startedAt || processed < 3 || total <= processed) return null;
  const elapsedMin = (now - new Date(startedAt).getTime()) / 60_000;
  if (!Number.isFinite(elapsedMin) || elapsedMin < 0.25) return null;
  const perMinute = processed / elapsedMin;
  if (perMinute <= 0) return null;
  return { perMinute, minutesLeft: (total - processed) / perMinute };
}

export function formatMinutesLeft(minutes: number): string {
  if (minutes < 1) return "under a minute left";
  if (minutes < 60) return `about ${Math.round(minutes)} min left`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `about ${h} h ${m} min left` : `about ${h} h left`;
}
