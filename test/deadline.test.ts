import { afterEach, describe, expect, it, vi } from "vitest";
import { StepTimeoutError, WATCHDOG_MS, fetchWithTimeout, withDbTimeouts, withDeadline } from "../app/lib/deadline.server";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withDeadline", () => {
  it("returns the result of work that finishes in time", async () => {
    await expect(withDeadline("step", 1_000, async () => 42)).resolves.toBe(42);
  });

  it("passes work errors through unchanged", async () => {
    const boom = new Error("boom");
    await expect(withDeadline("step", 1_000, async () => { throw boom; })).rejects.toBe(boom);
  });

  it("turns a hang into a StepTimeoutError naming the step, logging while it waits", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = withDeadline("Shopify sign-in", 20_000, () => new Promise<never>(() => {}), "shop.myshopify.com");
    const settled = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    expect(warn).toHaveBeenCalledWith("[slow] Shopify sign-in still waiting after 5s (shop.myshopify.com)");
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await settled;
    expect(err).toBeInstanceOf(StepTimeoutError);
    expect(err.step).toBe("Shopify sign-in");
    expect(err.message).toBe("Shopify sign-in didn't finish within 20 seconds");
    // No timers left behind once it has settled.
    warn.mockClear();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("fetchWithTimeout", () => {
  it("adds an abort signal when the caller didn't pass one", async () => {
    const inner = vi.fn<typeof fetch>(async () => new Response("ok"));
    await fetchWithTimeout(1_000, inner as typeof fetch)("https://example.test", { method: "POST" });
    const init = inner.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the caller's own signal", async () => {
    const inner = vi.fn<typeof fetch>(async () => new Response("ok"));
    const own = new AbortController().signal;
    await fetchWithTimeout(1_000, inner as typeof fetch)("https://example.test", { signal: own });
    expect(inner.mock.calls[0][1]!.signal).toBe(own);
  });

  it("aborts a request that never answers", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const started = Date.now();
    await expect(fetchWithTimeout(50, hanging)("https://example.test")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("withDbTimeouts", () => {
  it("adds connect and pool timeouts", () => {
    const url = new URL(withDbTimeouts("postgresql://u:p@host/db?sslmode=require")!);
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("connect_timeout")).toBe("10");
    expect(url.searchParams.get("pool_timeout")).toBe("10");
  });

  it("keeps values the URL already sets, and leaves missing or odd URLs alone", () => {
    expect(new URL(withDbTimeouts("postgresql://h/db?connect_timeout=3")!).searchParams.get("connect_timeout")).toBe("3");
    expect(withDbTimeouts(undefined)).toBeUndefined();
    expect(withDbTimeouts("not a url")).toBe("not a url");
  });
});
