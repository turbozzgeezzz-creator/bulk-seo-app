import { describe, expect, it } from "vitest";
import { estimateJob, formatMinutesLeft } from "../app/components/jobProgressMath";

describe("estimateJob", () => {
  const start = new Date("2026-09-27T10:00:00Z");
  const at = (min: number) => start.getTime() + min * 60_000;

  it("computes rate and time left from real counters", () => {
    expect(estimateJob(100, 500, start, at(5))).toEqual({ perMinute: 20, minutesLeft: 20 });
  });
  it("stays quiet until there's enough signal", () => {
    expect(estimateJob(2, 500, start, at(5))).toBeNull();
    expect(estimateJob(50, 500, start, at(0.1))).toBeNull();
    expect(estimateJob(50, 500, null, at(5))).toBeNull();
  });
  it("returns nothing once the job is complete", () => {
    expect(estimateJob(500, 500, start, at(5))).toBeNull();
  });
});

describe("formatMinutesLeft", () => {
  it.each([
    [0.4, "under a minute left"],
    [12.4, "about 12 min left"],
    [60, "about 1 h left"],
    [95, "about 1 h 35 min left"],
  ])("%s -> %s", (m, s) => expect(formatMinutesLeft(m)).toBe(s));
});
