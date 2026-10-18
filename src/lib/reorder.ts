// Phase 5: reorder help. Pure functions over reorder_rows(), so the rules are
// unit-tested and easy to explain to a shopkeeper.

export type ReorderRow = {
  variant_id: string;
  barcode: string;
  product_id: string;
  product: string;
  product_hi: string | null;
  product_en: string | null;
  category_hi: string;
  category_en: string;
  category_sort: number;
  size: string;
  stock: number;
  min_stock: number;
  sold: number; // pieces sold in the chosen window
  last_sold: string | null; // YYYY-MM-DD
  supplier_id: string | null;
  supplier: string | null;
  supplier_phone: string | null;
  last_received: string | null; // YYYY-MM-DD
};

/**
 * How many to order so the next window is covered and min stock stays on the shelf:
 *   sold in window + min stock − in stock   (never below 0)
 * Below-zero stock counts as 0: it means a receiving entry was missed, not
 * that we owe pieces. Example: sold 12, min 2, 2 left → order 12.
 */
export function suggestQty(sold: number, stock: number, min: number): number {
  return Math.max(0, sold + min - Math.max(stock, 0));
}

export const isLow = (r: Pick<ReorderRow, "stock" | "min_stock">) => r.stock <= r.min_stock;

export type OrderLine = { variant_id: string; size: string; qty: number; sold: number; stock: number; min: number };
export type OrderItem = { product_id: string; row: ReorderRow; lines: OrderLine[]; total: number };
export type SupplierOrder = {
  supplier_id: string | null;
  supplier: string | null;
  phone: string | null;
  items: OrderItem[];
  total: number;
};

/** Suggested orders grouped by the supplier who last sent each size. A size is
 *  included when it is low, or when it sold in the window and needs topping up. */
export function buildOrders(rows: ReorderRow[]): SupplierOrder[] {
  const bySupplier = new Map<string, SupplierOrder>();
  for (const r of rows) {
    const qty = suggestQty(r.sold, r.stock, r.min_stock);
    if (qty <= 0 || !(r.sold > 0 || isLow(r))) continue;
    const key = r.supplier_id ?? "";
    let order = bySupplier.get(key);
    if (!order) {
      order = { supplier_id: r.supplier_id, supplier: r.supplier, phone: r.supplier_phone, items: [], total: 0 };
      bySupplier.set(key, order);
    }
    let item = order.items.find((i) => i.product_id === r.product_id);
    if (!item) {
      item = { product_id: r.product_id, row: r, lines: [], total: 0 };
      order.items.push(item);
    }
    item.lines.push({ variant_id: r.variant_id, size: r.size, qty, sold: r.sold, stock: r.stock, min: r.min_stock });
    item.total += qty;
    order.total += qty;
  }
  const orders = [...bySupplier.values()];
  for (const o of orders) {
    o.items.sort((a, b) => a.row.category_sort - b.row.category_sort || a.row.product.localeCompare(b.row.product));
    for (const i of o.items) i.lines.sort((a, b) => a.size.localeCompare(b.size, "en", { numeric: true }));
  }
  // Known suppliers first, biggest order first; "supplier not known" last.
  return orders.sort((a, b) => Number(!a.supplier_id) - Number(!b.supplier_id) || b.total - a.total);
}

export type ProductStat = {
  product_id: string;
  row: ReorderRow;
  stock: number;
  sold: number;
  last_sold: string | null;
  last_received: string | null;
  /** Days the current stock lasts at the window's selling speed; null if nothing sold. */
  daysLeft: number | null;
};

export function byProduct(rows: ReorderRow[], days: number): ProductStat[] {
  const map = new Map<string, ProductStat>();
  for (const r of rows) {
    const p = map.get(r.product_id) ?? {
      product_id: r.product_id,
      row: r,
      stock: 0,
      sold: 0,
      last_sold: null,
      last_received: null,
      daysLeft: null,
    };
    p.stock += Math.max(r.stock, 0);
    p.sold += r.sold;
    if (r.last_sold && (!p.last_sold || r.last_sold > p.last_sold)) p.last_sold = r.last_sold;
    if (r.last_received && (!p.last_received || r.last_received > p.last_received)) p.last_received = r.last_received;
    map.set(r.product_id, p);
  }
  for (const p of map.values()) p.daysLeft = p.sold > 0 ? Math.floor(p.stock / (p.sold / days)) : null;
  return [...map.values()];
}

/** Best sellers in the window, with how many days their stock will last. */
export function fastMovers(rows: ReorderRow[], days: number, limit = 10): ProductStat[] {
  return byProduct(rows, days)
    .filter((p) => p.sold > 0)
    .sort((a, b) => b.sold - a.sold || (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .slice(0, limit);
}

/** Dead stock: in stock, not sold for `deadDays` (or never), and not received
 *  in that time either — fresh arrivals are not "dead". Oldest first. */
export function deadStock(rows: ReorderRow[], deadDays: number, today: string): ProductStat[] {
  const cutoff = shiftDate(today, -deadDays);
  return byProduct(rows, deadDays)
    .filter((p) => p.stock > 0 && (!p.last_sold || p.last_sold < cutoff) && (!p.last_received || p.last_received < cutoff))
    .sort((a, b) => (a.last_sold ?? "").localeCompare(b.last_sold ?? "") || b.stock - a.stock);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Order message for WhatsApp. `name` and `size` turn rows into the reader's language. */
export function orderText(
  order: SupplierOrder,
  opts: { shop: string; greeting: string; closing: string; pieces: (n: number) => string; name: (r: ReorderRow) => string; size: (s: string) => string },
): string {
  const lines = [opts.greeting, ""];
  order.items.forEach((item, i) => {
    const sizes = item.lines.map((l) => `${opts.size(l.size)} × ${l.qty}`).join(", ");
    lines.push(`${i + 1}. ${opts.name(item.row)} — ${sizes}`);
  });
  lines.push("", opts.pieces(order.total), "", opts.closing, opts.shop);
  return lines.join("\n");
}
