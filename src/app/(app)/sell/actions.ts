"use server";

import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { localName } from "@/lib/names";
import { requireSession } from "@/lib/session";
import { sizeLabel } from "@/lib/sizes";
import { fetchSellable } from "./data";
import type { ScanItem } from "./SellScreen";

export type SaleError =
  | "bad_pin"
  | "pin_locked"
  | "customer_required"
  | "bad_discount"
  | "item_not_found"
  | "bad_price"
  | "empty_cart"
  | "generic";

const KNOWN: SaleError[] = ["bad_pin", "pin_locked", "customer_required", "bad_discount", "item_not_found", "bad_price", "empty_cart"];

export type SalePayload = {
  payment_mode: "cash" | "upi" | "udhaar";
  customer_id?: string;
  new_customer?: { name: string; phone?: string };
  items: ({ variant_id: string; qty: number } | { category_id: string; size?: string; price: number; qty: number; description?: string })[];
  discount?: number;
  owner_pin?: string;
};

export type SaleResult = {
  sale_id: string;
  subtotal: number;
  discount: number;
  total: number;
  stock: { variant_id: string; stock_qty: number }[];
  negative: { barcode: string; stock_qty: number }[];
};

/** Save a sale. Prices, stock and the discount approval are all decided by
 *  make_sale() in the database; the phone only says what was scanned. */
export async function makeSale(payload: SalePayload): Promise<{ ok: SaleResult } | { error: SaleError }> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase.rpc("make_sale", { payload });
  if (error) return { error: KNOWN.find((k) => error.message.includes(k)) ?? "generic" };
  if (data?.error) return { error: KNOWN.includes(data.error) ? data.error : "generic" };
  revalidatePath("/stock");
  revalidatePath("/sell/today");
  return { ok: data as SaleResult };
}

/** A code that is not in the phone's list yet (e.g. received a minute ago). */
export async function lookupBarcode(code: string): Promise<ScanItem | null> {
  const { supabase } = await requireSession();
  const [v] = await fetchSellable(supabase, code.trim().toUpperCase());
  if (!v) return null;
  const t = await getTranslations();
  const locale = await getLocale();
  return {
    variantId: v.id,
    barcode: v.barcode,
    name: localName(v.product, locale),
    size: sizeLabel(v.size, t),
    price: v.selling_price,
    stock: v.stock_qty,
  };
}

export type CustomerHit = { id: string; name: string; phone: string | null; outstanding: number };

export async function searchCustomers(q: string): Promise<CustomerHit[]> {
  const { supabase } = await requireSession();
  let query = supabase
    .from("customers")
    .select("id, name, phone, outstanding")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);
  const term = q.trim().replace(/[,%()]/g, "");
  if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data } = await query;
  return data ?? [];
}
