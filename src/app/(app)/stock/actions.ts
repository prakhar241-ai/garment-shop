"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/session";

export type AdjustError = "owner_only" | "no_change" | "bad_qty" | "bad_reason" | "generic";
const KNOWN: AdjustError[] = ["owner_only", "no_change", "bad_qty", "bad_reason"];

/** Owner corrects a size's stock. adjust_stock() checks owner, shop and reason. */
export async function adjustStock(input: {
  variantId: string;
  mode: "set" | "change";
  value: number;
  reason: string;
  notes: string;
}): Promise<{ error: AdjustError } | { stock: number }> {
  const { supabase } = await requireOwner();
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_variant: input.variantId,
    p_mode: input.mode,
    p_value: input.value,
    p_reason: input.reason,
    p_notes: input.notes,
  });
  if (error) return { error: KNOWN.find((k) => error.message.includes(k)) ?? "generic" };
  revalidatePath(`/stock/${input.variantId}`);
  revalidatePath("/stock");
  return { stock: data as number };
}

export async function setMinStock(variantId: string, min: number): Promise<{ ok: boolean }> {
  const { supabase } = await requireOwner();
  if (!Number.isInteger(min) || min < 0 || min > 10000) return { ok: false };
  const { error } = await supabase.from("variants").update({ min_stock: min }).eq("id", variantId);
  revalidatePath(`/stock/${variantId}`);
  return { ok: !error };
}

export type PriceError = "no_change" | "bad_price" | "owner_only" | "generic";

/** Owner changes the selling price of one size, or all sizes of the item,
 *  without a new bill. set_price() records every change in price_changes. */
export async function changePrice(input: {
  variantId: string;
  allSizes: boolean;
  price: number;
  reason: "correction" | "markdown" | "increase";
}): Promise<{ error: PriceError } | { changed: string[] }> {
  const { supabase } = await requireOwner();
  const { data, error } = await supabase.rpc("set_price", {
    p_variant: input.variantId,
    p_all_sizes: input.allSizes,
    p_price: input.price,
    p_reason: input.reason,
  });
  if (error) {
    const known: PriceError[] = ["no_change", "bad_price", "owner_only"];
    return { error: known.find((k) => error.message.includes(k)) ?? "generic" };
  }
  revalidatePath(`/stock/${input.variantId}`);
  revalidatePath("/stock");
  revalidatePath("/sell");
  return { changed: (data as { changed: string[] }).changed };
}
