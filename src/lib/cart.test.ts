import { describe, expect, it } from "vitest";
import { addTagged, cartTotal, percentDiscount, stepQty, stockAfter, subtotal, type CartLine } from "./cart";
import { slipText, whatsappLink } from "./slip";

const shirt = { variantId: "v1", barcode: "S1-00001", name: "Shirt", size: "M", price: 49900, stock: 1 };
const jeans = { variantId: "v2", barcode: "S1-00002", name: "Jeans", size: "L", price: 99900, stock: 0 };

describe("cart", () => {
  it("scanning the same item twice stacks it", () => {
    let c: CartLine[] = [];
    c = addTagged(c, shirt, false);
    c = addTagged(c, shirt, false);
    expect(c).toHaveLength(1);
    expect(c[0].qty).toBe(2);
    expect(subtotal(c)).toBe(99800);
  });

  it("a returned item is a separate negative line", () => {
    let c = addTagged([], shirt, false);
    c = addTagged(c, shirt, true);
    expect(c.map((l) => l.qty)).toEqual([1, -1]);
    expect(subtotal(c)).toBe(0);
  });

  it("exchange: return jeans, take a shirt", () => {
    let c = addTagged([], jeans, true);
    c = addTagged(c, shirt, false);
    expect(cartTotal(c, 0)).toBe(49900 - 99900);
  });

  it("stepping quantity keeps direction and removes at zero", () => {
    let c = addTagged([], shirt, true);
    c = stepQty(c, c[0].key, 1);
    expect(c[0].qty).toBe(-2);
    c = stepQty(c, c[0].key, -1);
    c = stepQty(c, c[0].key, -1);
    expect(c).toEqual([]);
  });

  it("stock after the cart, for the below-zero warning", () => {
    let c = addTagged([], shirt, false);
    c = addTagged(c, shirt, false);
    c = addTagged(c, jeans, true);
    expect(stockAfter(c)).toEqual(
      new Map([
        ["v1", -1],
        ["v2", 1],
      ]),
    );
  });

  it("percent discount rounds down to whole rupees and caps at 100%", () => {
    expect(percentDiscount(99800, 10)).toBe(9900); // 99.80 -> 99
    expect(percentDiscount(50000, 150)).toBe(50000);
    expect(percentDiscount(-100, 10)).toBe(0);
    expect(percentDiscount(50000, 0)).toBe(0);
  });
});

describe("whatsapp slip", () => {
  const labels = { total: "Total", discount: "Discount", returned: "returned", mode: "Paid by", thanks: "Thank you!" };

  it("lists items, returns, discount and total", () => {
    const text = slipText({
      shop: "Demo Garments",
      date: new Date("2026-10-17T08:00:00Z"),
      lines: [
        { name: "Shirt", size: "M", qty: 2, price: 49900 },
        { name: "Jeans", size: "L", qty: -1, price: 99900 },
      ],
      discount: 1000,
      total: -1000,
      modeLabel: "Cash",
      labels,
    });
    expect(text).toContain("*Demo Garments*\n17/10/2026");
    expect(text).toContain("Shirt M × 2 = ₹998");
    expect(text).toContain("Jeans L × 1 (returned) = -₹999");
    expect(text).toContain("Discount: -₹10");
    expect(text).toContain("*Total: -₹10*");
  });

  it("links straight to an Indian number when known", () => {
    expect(whatsappLink("hi", "98765 43210")).toBe("https://wa.me/919876543210?text=hi");
    expect(whatsappLink("a b", null)).toBe("https://wa.me/?text=a%20b");
  });
});
