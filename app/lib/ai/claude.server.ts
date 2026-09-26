import Anthropic from "@anthropic-ai/sdk";

/**
 * Model choice drives both output quality and per-item cost (and therefore
 * plan pricing). Defaults to Claude Opus 5; override with AI_MODEL once
 * the per-item cost has been measured on real catalogs (open decision).
 */
export const AI_MODEL = process.env.AI_MODEL?.trim() || "claude-opus-5";

let client: Anthropic | null = null;

export function getClaude(): Anthropic {
  if (!client) {
    // The SDK retries 408/409/429/5xx and connection errors itself with
    // backoff; we raise the retry count because bulk jobs hit rate limits in
    // bursts, and cap each request so a hung call can't stall a job chunk.
    client = new Anthropic({ maxRetries: 4, timeout: 60_000 });
  }
  return client;
}

/**
 * How a failure should be handled by the job runner:
 *  - "item":      this one item failed; record the reason and move on.
 *  - "retryable": transient; leave the item pending and try again later.
 *  - "fatal":     a configuration problem (bad API key, no credit) that will
 *                 fail every item, so stop the job and say why.
 */
export type FailureKind = "item" | "retryable" | "fatal";

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export function classifyAnthropicError(err: unknown): GenerationError {
  if (err instanceof GenerationError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new GenerationError("The AI service rejected the app's API credentials. The app operator needs to fix this; no items were changed.", "fatal");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new GenerationError("The AI service is rate limiting requests; this item will be retried.", "retryable");
  }
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.message ?? "";
    if (/credit balance|billing/i.test(msg)) {
      return new GenerationError("The AI account is out of credit. The app operator needs to fix this; no items were changed.", "fatal");
    }
    return new GenerationError(`The AI service rejected this request: ${msg.slice(0, 200)}`, "item");
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIConnectionError) {
    return new GenerationError("Could not reach the AI service; this item will be retried.", "retryable");
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new GenerationError("The AI service had a temporary error; this item will be retried.", "retryable");
  }
  if (err instanceof Anthropic.APIError) {
    return new GenerationError(`AI service error ${err.status ?? ""}: ${err.message.slice(0, 200)}`, "item");
  }
  return new GenerationError(err instanceof Error ? err.message : String(err), "item");
}
