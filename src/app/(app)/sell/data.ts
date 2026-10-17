import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** What the Sell screen needs to know about a tagged item. No cost price. */
export type Sellable = {
  id: string;
  barcode: string;
  size: string;
  selling_price: number;
  stock_qty: number;
  product: { name: string; name_hi: string | null; name_en: string | null };
};

const PAGE = 1000; // Supabase returns at most 1000 rows per request

/** All live variants of the shop (or the one with `barcode`), paged so a shop
 *  with a few thousand sizes still loads completely. */
export async function fetchSellable(supabase: SupabaseClient, barcode?: string): Promise<Sellable[]> {
  const all: Sellable[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("variants")
      .select("id, barcode, size, selling_price, stock_qty, product:products!inner(name, name_hi, name_en, deleted_at)")
      .is("deleted_at", null)
      .is("product.deleted_at", null)
      .order("barcode")
      .range(from, from + PAGE - 1);
    if (barcode) q = q.eq("barcode", barcode);
    const { data, error } = await q.returns<Sellable[]>();
    if (error || !data) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}
