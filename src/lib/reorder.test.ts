import { describe, expect, it } from "vitest";
import { buildOrders, deadStock, fastMovers, orderText, suggestQty, type ReorderRow } from "./reorder";

function row(over: Partial<ReorderRow>): ReorderRow {
  return {
    variant_id: "v",
    barcode: "S1-00001",
    product_id: "p1",
    product: "Shirt",
    product_hi: "शर्ट",
    product_en: "Shirt",
    category_hi: "शर्ट",
    category_en: "Shirts",
    category_sort: 1,
    size: "M",
    stock: 0,
    min_stock: 2,
    sold: 0,
    last_sold: null,
    supplier_id: "s1",
    supplier: "Gupta",
    supplier_phone: "9811111111",
    last_received: "2026-09-01",
    ...over,
  };
}

describe("suggestQty", () => {
  it("matches the brief: sold 12 in 30 days, 2 left, suggest 12", () => {
    expect(suggestQty(12, 2, 2)).toBe(12);
  });
  it("never negative; below-zero stock counts as zero", () => {
    expect(suggestQty(1, 10, 2)).toBe(0);
    expect(suggestQty(3, -2, 2)).toBe(5);
    expect(suggestQty(0, 0, 2)).toBe(2);
  });
});

describe("buildOrders", () => {
  const rows = [
    row({ variant_id: "a", size: "M", sold: 5, stock: 1 }), // 5+2-1 = 6
    row({ variant_id: "b", size: "L", sold: 0, stock: 1 }), // low, unsold: 2-1 = 1
    row({ variant_id: "c", size: "XL", sold: 0, stock: 5 }), // fine: skipped
    row({ variant_id: "d", product_id: "p2", product: "Jeans", size: "32", sold: 2, stock: 4, supplier_id: "s2", supplier: "Sharma" }), // 2+2-4 = 0
    row({ variant_id: "e", product_id: "p3", product: "Frock", size: "4-5Y", sold: 1, stock: 0, supplier_id: null, supplier: null }),
  ];

  it("groups by last supplier, explains each line, skips what is not needed", () => {
    const orders = buildOrders(rows);
    expect(orders.map((o) => [o.supplier, o.total])).toEqual([
      ["Gupta", 7],
      [null, 3],
    ]);
    expect(orders[0].items[0].lines.map((l) => [l.size, l.qty, l.sold, l.stock, l.min])).toEqual([
      ["L", 1, 0, 1, 2],
      ["M", 6, 5, 1, 2],
    ]);
  });

  it("writes a WhatsApp order", () => {
    const text = orderText(buildOrders(rows)[0], {
      shop: "Demo Garments",
      greeting: "Namaste, please send:",
      closing: "Thank you",
      pieces: (n) => `Total ${n} pcs`,
      name: (r) => r.product_en ?? r.product,
      size: (s) => s,
    });
    expect(text).toBe("Namaste, please send:\n\n1. Shirt — L × 1, M × 6\n\nTotal 7 pcs\n\nThank you\nDemo Garments");
  });
});

describe("fast movers and dead stock", () => {
  const rows = [
    row({ variant_id: "a", product_id: "p1", sold: 10, stock: 5 }),
    row({ variant_id: "b", product_id: "p1", sold: 5, stock: 1, size: "L" }),
    row({ variant_id: "c", product_id: "p2", product: "Saree", sold: 2, stock: 20 }),
    row({ variant_id: "d", product_id: "p3", product: "Dohar", stock: 4, last_sold: "2026-06-01", last_received: "2026-05-01" }),
    row({ variant_id: "e", product_id: "p4", product: "New kurta", stock: 6, last_received: "2026-10-10" }),
    row({ variant_id: "f", product_id: "p5", product: "Old stole", stock: 3, last_sold: null, last_received: null }),
  ];

  it("best sellers with days of stock left", () => {
    const fast = fastMovers(rows, 30);
    expect(fast.map((p) => [p.row.product, p.sold, p.daysLeft])).toEqual([
      ["Shirt", 15, 12], // 6 pieces at 0.5/day
      ["Saree", 2, 300],
    ]);
  });

  it("dead stock skips fresh arrivals; never-sold first", () => {
    const dead = deadStock(rows, 60, "2026-10-18");
    expect(dead.map((p) => p.row.product)).toEqual(["Old stole", "Dohar"]);
  });
});
