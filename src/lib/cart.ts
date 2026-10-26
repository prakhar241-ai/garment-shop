import type { Paise } from "./money";

// The cart on the Sell screen. The database recomputes everything when the
// sale is saved; this is only for showing totals while scanning.

export type CartLine =
  | {
      kind: "tagged";
      key: string;
      variantId: string;
      barcode: string;
      name: string;
      size: string;
      price: Paise; // what the customer pays (offer price if an offer runs)
      regular?: Paise; // the tag price, when an offer lowered it
      offer?: string; // name of the offer applied
      qty: number;
      stock: number;
    }
  | { kind: "quick"; key: string; categoryId: string; name: string; size: string; price: Paise; qty: number };

/** qty < 0 means the customer is returning that item. */
export const lineTotal = (l: CartLine): Paise => l.price * l.qty;

export const subtotal = (lines: CartLine[]): Paise => lines.reduce((s, l) => s + lineTotal(l), 0);

/** Percent discount on a subtotal, rounded down to whole rupees (never more than asked). */
export function percentDiscount(sub: Paise, percent: number): Paise {
  if (sub <= 0 || !(percent > 0)) return 0;
  return Math.floor((sub * Math.min(percent, 100)) / 100 / 100) * 100;
}

export function cartTotal(lines: CartLine[], discount: Paise): Paise {
  return subtotal(lines) - discount;
}

/** Adding a scanned item: same item and same direction (sale/return) stacks. */
export function addTagged(
  lines: CartLine[],
  item: Omit<Extract<CartLine, { kind: "tagged" }>, "kind" | "key" | "qty">,
  returning: boolean,
): CartLine[] {
  const sign = returning ? -1 : 1;
  const i = lines.findIndex((l) => l.kind === "tagged" && l.variantId === item.variantId && Math.sign(l.qty) === sign);
  if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, qty: l.qty + sign } : l));
  return [...lines, { kind: "tagged", key: `${item.variantId}:${sign}`, qty: sign, ...item }];
}

/** Change a line's quantity by +1/-1 in its own direction; it never flips from sale to return. */
export function stepQty(lines: CartLine[], key: string, delta: 1 | -1): CartLine[] {
  return lines
    .map((l) => {
      if (l.key !== key) return l;
      const sign = Math.sign(l.qty);
      return { ...l, qty: l.qty + delta * sign };
    })
    .filter((l) => l.qty !== 0);
}

/** How many of each variant the cart takes out of stock (returns put back). */
export function stockAfter(lines: CartLine[]): Map<string, number> {
  const left = new Map<string, number>();
  for (const l of lines) {
    if (l.kind !== "tagged") continue;
    left.set(l.variantId, (left.get(l.variantId) ?? l.stock) - l.qty);
  }
  return left;
}
