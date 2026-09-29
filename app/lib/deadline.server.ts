/**
 * Bounded waiting for the embedded page-load path.
 *
 * A page load inside Shopify admin waits on Shopify sign-in (session lookup,
 * and a token exchange/refresh call to Shopify when the stored access token
 * has expired) and on database queries. Nothing in that path had a deadline
 * of its own, and Node's fetch waits up to 300 s for response headers, the
 * same as Vercel's function limit. A stalled call therefore showed as a blank
 * admin page for ~5 minutes, then a platform error, with nothing in the logs
 * saying which step it was stuck on.
 *
 * withDeadline() caps a step, logs "[slow] … still waiting" every
 * WATCHDOG_MS so the logs show exactly where a request is stuck, and throws a
 * StepTimeoutError naming the step when the deadline passes.
 */

export const WATCHDOG_MS = 5_000;

export class StepTimeoutError extends Error {
  constructor(
    readonly step: string,
    readonly ms: number,
  ) {
    super(`${step} didn't finish within ${Math.round(ms / 1000)} seconds`);
    this.name = "StepTimeoutError";
  }
}

export async function withDeadline<T>(step: string, ms: number, work: () => Promise<T>, context = ""): Promise<T> {
  const started = Date.now();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const watchdog = setInterval(() => {
    console.warn(`[slow] ${step} still waiting after ${Math.round((Date.now() - started) / 1000)}s${context ? ` (${context})` : ""}`);
  }, WATCHDOG_MS);
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new StepTimeoutError(step, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    clearInterval(watchdog);
  }
}

/** A fetch that gives up after `ms` unless the caller passed its own abort signal. */
export function fetchWithTimeout(ms: number, fetchImpl: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return (input, init) => fetchImpl(input, init?.signal ? init : { ...init, signal: AbortSignal.timeout(ms) });
}

/** Appends connect/pool timeouts to a Postgres URL unless it already sets them. */
export function withDbTimeouts(url: string | undefined, connectTimeoutS = 10, poolTimeoutS = 10): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", String(connectTimeoutS));
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", String(poolTimeoutS));
    return u.toString();
  } catch {
    return url;
  }
}
