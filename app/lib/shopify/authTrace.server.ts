import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * A record of each embedded sign-in attempt, kept in the database so it can
 * be read back afterwards (GET /internal/diag, signed with the app secret).
 *
 * Why: the Shopify library explains why it rejected or restarted a sign-in
 * only in its own log lines, mostly at debug level, and those are only
 * visible in the hosting provider's live log stream. Each attempt stores its
 * outcome, timing and the library's log lines for that request (no tokens:
 * the library never logs them), so a failed open by a merchant can be
 * diagnosed after the fact.
 */

const KEEP_DAYS = 7;
const MAX_LINES = 40;

const requestLines = new AsyncLocalStorage<string[]>();

/** Runs `work` collecting every Shopify library log line it produces. */
export function withLibraryLogCapture<T>(work: (lines: string[]) => Promise<T>): Promise<T> {
  const lines: string[] = [];
  return requestLines.run(lines, () => work(lines));
}

/** Shopify library `logger.log`: prints at the configured level, and always keeps the line for the current request's trace. */
export function libraryLogFunction(printLevel: number) {
  return (severity: number, message: string) => {
    const lines = requestLines.getStore();
    // Session tokens are short-lived, but still not kept: redact any JWT.
    if (lines && lines.length < MAX_LINES) lines.push(message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "<session token>").slice(0, 1_000));
    if (severity <= printLevel) {
      (severity === 0 ? console.error : severity === 1 ? console.warn : console.log)(message);
    }
  };
}

export type AuthOutcome = "ok" | "bounce" | "bounce-page" | "responded" | "loop-stopped" | "timeout" | "config-error" | "error";

export async function recordAuthEvent(
  prisma: PrismaClient,
  event: { shop: string; path: string; outcome: AuthOutcome; ms: number; detail: string[] },
): Promise<void> {
  try {
    await prisma.authEvent.create({
      data: { shop: event.shop, path: event.path.slice(0, 200), outcome: event.outcome, ms: Math.round(event.ms), detail: event.detail.join("\n").slice(0, 8_000) },
    });
    if (Math.random() < 0.05) {
      await prisma.authEvent.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
    }
  } catch (err) {
    console.error(`[auth] couldn't record sign-in trace for ${event.shop}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Signature for GET /internal/diag: HMAC-SHA256 of "<shop>:<unix seconds>" keyed by the app's client secret. */
export function signDiag(shop: string, ts: number, secret: string): string {
  return createHmac("sha256", secret).update(`${shop}:${ts}`).digest("hex");
}

export function verifyDiag(shop: string, ts: number, sig: string, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || !shop || !Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(now / 1000 - ts) > 300) return false;
  const expected = Buffer.from(signDiag(shop, ts, secret), "hex");
  return timingSafeEqual(expected, Buffer.from(sig, "hex"));
}
