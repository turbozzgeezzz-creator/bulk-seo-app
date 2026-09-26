/**
 * Fetches a product image's real bytes for the vision model.
 *
 * Replaces Luxe+'s visionFetch.ts, whose bare `fetch(url)` had no timeout, no
 * retry, trusted the Content-Type header, and returned `null` on every kind
 * of failure — which surfaced as "could not fetch real bytes" with no way to
 * tell a slow CDN apart from a deleted image. Here:
 *
 *  - every attempt has its own timeout;
 *  - network errors, timeouts, 408/425/429 and 5xx are retried with
 *    exponential backoff + jitter (honouring Retry-After);
 *  - Shopify CDN images are requested at a bounded width, so a 20 MB original
 *    doesn't blow the vision API's size limit or the timeout;
 *  - we ask for formats the vision API accepts, and check the actual magic
 *    bytes instead of trusting the header (a CDN negotiating AVIF would
 *    otherwise fail later with an opaque API error);
 *  - failures come back as a typed result with a specific, human-readable
 *    reason, never a bare null.
 */

export type VisionMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type ImageFetchResult =
  | { ok: true; data: string; mediaType: VisionMediaType; bytes: number; attempts: number }
  | { ok: false; reason: string; retryable: boolean; attempts: number };

export interface ImageFetchOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  maxBytes?: number;
  /** Longest edge requested from the Shopify CDN. */
  cdnWidth?: number;
}

// Vision API limit is 5 MB per image (base64-decoded).
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
// Images larger than ~1568px on the long edge are downscaled by the API anyway.
const DEFAULT_CDN_WIDTH = 1568;
const MAX_RETRY_AFTER_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isShopifyCdnUrl(url: URL): boolean {
  return url.hostname === "cdn.shopify.com" || (url.hostname.endsWith(".myshopify.com") && url.pathname.startsWith("/cdn/"));
}

/** Ask the Shopify CDN for a bounded-size rendition unless the URL already pins a size. */
export function withCdnWidth(rawUrl: string, width: number): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (!isShopifyCdnUrl(url)) return rawUrl;
  if (url.searchParams.has("width") || url.searchParams.has("height")) return rawUrl;
  url.searchParams.set("width", String(width));
  return url.toString();
}

export function sniffMediaType(buf: Uint8Array): VisionMediaType | "avif" | "heic" | null {
  const at = (i: number) => buf[i];
  if (buf.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (buf.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (buf.length >= 4 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.slice(from, to));
  if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("avi")) return "avif";
    if (brand.startsWith("hei") || brand.startsWith("mif")) return "heic";
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return null;
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * base * 0.5);
}

function describeNetworkError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  }
  const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return `network error (${err instanceof Error ? err.message : String(err)}${cause})`;
}

export async function fetchImageForVision(rawUrl: string, options: ImageFetchOptions = {}): Promise<ImageFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? 4;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!/^https:\/\//i.test(rawUrl)) {
    return { ok: false, reason: `Image URL is not an https URL (${rawUrl.slice(0, 120)}).`, retryable: false, attempts: 0 };
  }
  const url = withCdnWidth(rawUrl, options.cdnWidth ?? DEFAULT_CDN_WIDTH);

  let lastReason = "unknown error";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "image/jpeg,image/png,image/webp,image/gif;q=0.9" },
        redirect: "follow",
      });
    } catch (err) {
      lastReason = describeNetworkError(err, timeoutMs);
      if (attempt < maxAttempts) await sleep(backoffMs(attempt));
      continue;
    }

    if (!res.ok) {
      lastReason = `the image host returned HTTP ${res.status}`;
      if (!isRetryableStatus(res.status)) {
        const hint = res.status === 404 || res.status === 410 ? " (the image may have been deleted)" : "";
        return { ok: false, reason: `Could not download the image: ${lastReason}${hint}.`, retryable: false, attempts: attempt };
      }
      if (attempt < maxAttempts) await sleep(retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt));
      continue;
    }

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, reason: `The image is too large to analyse (${(declared / 1048576).toFixed(1)} MB).`, retryable: false, attempts: attempt };
    }

    let buf: Uint8Array;
    try {
      buf = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      // Body cut off mid-transfer: treat like a network error.
      lastReason = describeNetworkError(err, timeoutMs);
      if (attempt < maxAttempts) await sleep(backoffMs(attempt));
      continue;
    }

    if (buf.length === 0) {
      lastReason = "the image host returned an empty body";
      if (attempt < maxAttempts) await sleep(backoffMs(attempt));
      continue;
    }
    if (buf.length > maxBytes) {
      return { ok: false, reason: `The image is too large to analyse (${(buf.length / 1048576).toFixed(1)} MB).`, retryable: false, attempts: attempt };
    }

    const sniffed = sniffMediaType(buf);
    if (sniffed === "avif" || sniffed === "heic") {
      return { ok: false, reason: `The image is in ${sniffed.toUpperCase()} format, which the AI can't read. Re-upload it as JPEG, PNG or WebP.`, retryable: false, attempts: attempt };
    }
    if (!sniffed) {
      const declaredType = res.headers.get("content-type") ?? "unknown";
      return { ok: false, reason: `The URL did not return a supported image (content-type: ${declaredType}).`, retryable: false, attempts: attempt };
    }

    return { ok: true, data: Buffer.from(buf).toString("base64"), mediaType: sniffed, bytes: buf.length, attempts: attempt };
  }

  return { ok: false, reason: `Could not download the image after ${maxAttempts} attempts: ${lastReason}.`, retryable: true, attempts: maxAttempts };
}
