"use server";

import { revalidatePath } from "next/cache";
import { ROUNDING_RULES, type RoundingRule } from "@/lib/pricing";
import { requireOwner } from "@/lib/session";

export type SettingsInput = {
  rounding: RoundingRule;
  categories: { id: string; markup: number; minStock: number }[];
};

/** Owner saves the rounding rule and per-category markup / minimum stock.
 *  Row Level Security also limits these updates to owners of this shop. */
export async function saveShopSettings(input: SettingsInput): Promise<{ ok: boolean }> {
  const { supabase, shop } = await requireOwner();
  if (!ROUNDING_RULES.includes(input.rounding)) return { ok: false };
  for (const c of input.categories) {
    if (!(c.markup >= 0 && c.markup <= 1000) || !Number.isInteger(c.minStock) || c.minStock < 0) return { ok: false };
  }

  const { error } = await supabase
    .from("shops")
    .update({ settings: { ...shop.settings, rounding: input.rounding } })
    .eq("id", shop.id);
  if (error) return { ok: false };

  for (const c of input.categories) {
    const { error: catError } = await supabase
      .from("categories")
      .update({ default_markup_percent: c.markup, default_min_stock: c.minStock })
      .eq("id", c.id);
    if (catError) return { ok: false };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
