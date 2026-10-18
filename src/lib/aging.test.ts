import { describe, expect, it } from "vitest";
import { ageBucket, daysSince } from "./aging";

describe("aging", () => {
  it("counts calendar days in India, not 24-hour blocks", () => {
    // 11:30 pm IST on the 1st to 12:30 am IST on the 2nd is one day.
    expect(daysSince("2026-10-01T18:00:00Z", new Date("2026-10-01T19:00:00Z"))).toBe(1);
    expect(daysSince("2026-10-01T05:00:00Z", new Date("2026-10-01T15:00:00Z"))).toBe(0);
    expect(daysSince("2026-09-01T05:00:00Z", new Date("2026-10-01T05:00:00Z"))).toBe(30);
  });

  it("never goes negative", () => {
    expect(daysSince("2026-10-05T00:00:00Z", new Date("2026-10-01T00:00:00Z"))).toBe(0);
  });

  it("buckets", () => {
    expect([0, 29, 30, 59, 60, 400].map(ageBucket)).toEqual(["fresh", "fresh", "late", "late", "old", "old"]);
  });
});
