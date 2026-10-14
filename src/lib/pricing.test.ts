import { describe, expect, it } from "vitest";
import { marginPercent, roundPrice, suggestSellingPrice } from "./pricing";
import { formatDate, formatPaise, rupeesToPaise } from "./money";

const r = (rupees: number) => rupees * 100;

describe("roundPrice", () => {
  it("49_99 goes up to the next 49 or 99", () => {
    expect(roundPrice(r(450), "49_99")).toBe(r(499));
    expect(roundPrice(r(420), "49_99")).toBe(r(449));
    expect(roundPrice(r(449), "49_99")).toBe(r(449));
    expect(roundPrice(r(500), "49_99")).toBe(r(549));
    expect(roundPrice(r(30), "49_99")).toBe(r(49));
    expect(roundPrice(r(60), "49_99")).toBe(r(99));
  });

  it("never rounds down, even by a few paise", () => {
    expect(roundPrice(44901, "49_99")).toBe(r(499));
    expect(roundPrice(45001, "none")).toBe(r(451));
  });

  it("other rules", () => {
    expect(roundPrice(r(450), "99")).toBe(r(499));
    expect(roundPrice(r(510), "99")).toBe(r(599));
    expect(roundPrice(r(450), "9")).toBe(r(459));
    expect(roundPrice(r(459), "9")).toBe(r(459));
    expect(roundPrice(r(453), "10")).toBe(r(460));
    expect(roundPrice(r(0), "49_99")).toBe(0);
  });
});

describe("suggestSellingPrice", () => {
  it("applies markup then rounding", () => {
    expect(suggestSellingPrice(r(300), 50, "49_99")).toBe(r(499)); // 450 -> 499
    expect(suggestSellingPrice(r(300), 40, "49_99")).toBe(r(449)); // 420 -> 449
    expect(suggestSellingPrice(r(1000), 37.5, "none")).toBe(r(1375));
  });

  it("returns 0 for a zero cost", () => {
    expect(suggestSellingPrice(0, 50, "49_99")).toBe(0);
  });
});

describe("marginPercent", () => {
  it("is margin on selling price", () => {
    expect(marginPercent(r(300), r(500))).toBe(40);
    expect(marginPercent(r(300), 0)).toBe(0);
  });
});

describe("money", () => {
  it("parses rupees to paise without floats", () => {
    expect(rupeesToPaise("450")).toBe(45000);
    expect(rupeesToPaise("450.5")).toBe(45050);
    expect(rupeesToPaise("1,25,000")).toBe(12500000);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("-5")).toBeNull();
  });

  it("formats with Indian grouping", () => {
    expect(formatPaise(12500000)).toBe("₹1,25,000");
    expect(formatPaise(49900)).toBe("₹499");
    expect(formatPaise(45050)).toBe("₹450.50");
    expect(formatPaise(-10000)).toBe("-₹100");
  });

  it("formats dates as DD/MM/YYYY", () => {
    expect(formatDate("2026-10-14T10:00:00Z")).toBe("14/10/2026");
  });
});
