import type { Paise } from "./money";

// Festival / clearance offers. Mirrors offer_price() and the offer choice in
// make_sale() in the database, which decide the real price; this is for
// showing prices on the Sell screen while scanning.

export type Offer = {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  value: number; // percent, or a fixed price in paise
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  category_ids: string[] | null; // null/empty = all categories
  active: boolean;
};

/** Percent off is rounded DOWN to the whole rupee; a fixed price only counts if lower. */
export function offerPrice(price: Paise, kind: Offer["kind"], value: number): Paise {
  if (kind === "percent") return Math.min(price, Math.floor((price * (100 - value)) / 10000) * 100);
  return Math.min(price, value);
}

export function runningOn(o: Offer, day: string): boolean {
  return o.active && o.starts_on <= day && day <= o.ends_on;
}

export function appliesTo(o: Offer, categoryId: string): boolean {
  return !o.category_ids || o.category_ids.length === 0 || o.category_ids.includes(categoryId);
}

/** The offer giving the lowest price for this item today, or null. */
export function bestOffer(offers: Offer[], categoryId: string, price: Paise, day: string): { offer: Offer; price: Paise } | null {
  let best: { offer: Offer; price: Paise } | null = null;
  for (const o of offers) {
    if (!runningOn(o, day) || !appliesTo(o, categoryId)) continue;
    const p = offerPrice(price, o.kind, o.value);
    if (p < price && (!best || p < best.price)) best = { offer: o, price: p };
  }
  return best;
}

export type OfferStatus = "running" | "upcoming" | "ended" | "stopped";

export function offerStatus(o: Offer, day: string): OfferStatus {
  if (!o.active) return "stopped";
  if (day < o.starts_on) return "upcoming";
  if (day > o.ends_on) return "ended";
  return "running";
}
