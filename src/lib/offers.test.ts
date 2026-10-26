import { describe, expect, it } from "vitest";
import { bestOffer, offerPrice, offerStatus, type Offer } from "./offers";

const r = (rupees: number) => rupees * 100;
const o = (over: Partial<Offer>): Offer => ({
  id: "o",
  name: "Diwali",
  kind: "percent",
  value: 10,
  starts_on: "2026-10-20",
  ends_on: "2026-10-31",
  category_ids: null,
  active: true,
  ...over,
});

describe("offers", () => {
  it("percent off rounds down to the rupee; fixed price only if lower", () => {
    expect(offerPrice(r(649), "percent", 10)).toBe(r(584)); // 584.10
    expect(offerPrice(r(999), "percent", 12.5)).toBe(r(874)); // 874.125
    expect(offerPrice(r(649), "fixed", r(499))).toBe(r(499));
    expect(offerPrice(r(399), "fixed", r(499))).toBe(r(399));
  });

  it("best offer: right category, running today, lowest price", () => {
    const offers = [
      o({ id: "a", value: 10, category_ids: ["sarees"] }),
      o({ id: "b", kind: "fixed", value: r(499) }),
      o({ id: "c", value: 50, ends_on: "2026-10-25" }), // ended
      o({ id: "d", value: 60, active: false }), // stopped
    ];
    expect(bestOffer(offers, "sarees", r(649), "2026-10-26")).toEqual({ offer: offers[1], price: r(499) });
    // ₹450 shirt: the ₹499 fixed price is dearer, and the 10% is sarees only.
    expect(bestOffer(offers, "shirts", r(450), "2026-10-26")).toBeNull();
    expect(bestOffer(offers, "sarees", r(450), "2026-10-26")?.offer.id).toBe("a");
    expect(bestOffer(offers, "sarees", r(649), "2026-11-01")).toBeNull();
  });

  it("status", () => {
    expect(offerStatus(o({}), "2026-10-19")).toBe("upcoming");
    expect(offerStatus(o({}), "2026-10-20")).toBe("running");
    expect(offerStatus(o({}), "2026-10-31")).toBe("running");
    expect(offerStatus(o({}), "2026-11-01")).toBe("ended");
    expect(offerStatus(o({ active: false }), "2026-10-25")).toBe("stopped");
  });
});
