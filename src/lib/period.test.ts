import { describe, expect, it } from "vitest";
import { buckets, grainFor, resolvePeriod } from "./period";

// 18 Oct 2026, 1 am in India = 17 Oct 19:30 UTC.
const now = new Date("2026-10-17T19:30:00Z");

describe("periods", () => {
  it("uses the Indian date, not UTC", () => {
    expect(resolvePeriod("today", undefined, undefined, now)).toMatchObject({ from: "2026-10-18", to: "2026-10-18" });
  });

  it("named periods", () => {
    expect(resolvePeriod("7d", undefined, undefined, now)).toMatchObject({ from: "2026-10-12", to: "2026-10-18", grain: "day" });
    expect(resolvePeriod("month", undefined, undefined, now)).toMatchObject({ from: "2026-10-01", to: "2026-10-18" });
    expect(resolvePeriod("lastMonth", undefined, undefined, now)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod("lastMonth", undefined, undefined, new Date("2026-01-10T06:00:00Z"))).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("custom ranges are checked; bad ones fall back to 7 days", () => {
    expect(resolvePeriod("custom", "2026-01-01", "2026-06-30", now)).toMatchObject({ key: "custom", grain: "week" });
    expect(resolvePeriod("custom", "2026-10-10", "2026-10-01", now).key).toBe("7d");
    expect(resolvePeriod("custom", "2026-10-01", "2026-12-01", now).key).toBe("7d"); // future
    expect(resolvePeriod("custom", "x", "y", now).key).toBe("7d");
  });

  it("grain grows with the range", () => {
    expect(grainFor("2026-10-01", "2026-10-31")).toBe("day");
    expect(grainFor("2026-05-01", "2026-10-31")).toBe("week");
    expect(grainFor("2025-01-01", "2026-10-31")).toBe("month");
  });

  it("buckets cover the range, weeks start Monday", () => {
    expect(buckets("2026-10-16", "2026-10-18", "day")).toEqual(["2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(buckets("2026-10-14", "2026-10-27", "week")).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(buckets("2026-11-15", "2027-01-02", "month")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});
