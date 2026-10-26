"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/session";

export type OfferError = "name" | "value" | "dates" | "generic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createOffer(input: {
  name: string;
  kind: "percent" | "fixed";
  value: number; // percent, or paise for a fixed price
  startsOn: string;
  endsOn: string;
  categoryIds: string[];
}): Promise<{ error?: OfferError }> {
  const { supabase } = await requireOwner();
  if (!input.name.trim()) return { error: "name" };
  if (input.kind === "percent" ? !(input.value >= 1 && input.value < 100) : !(Number.isInteger(input.value) && input.value > 0)) {
    return { error: "value" };
  }
  if (!DATE.test(input.startsOn) || !DATE.test(input.endsOn) || input.endsOn < input.startsOn) return { error: "dates" };

  // Row Level Security only lets owners insert offers for their own shop.
  const { error } = await supabase.from("offers").insert({
    name: input.name.trim(),
    kind: input.kind,
    value: input.value,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    category_ids: input.categoryIds.length ? input.categoryIds : null,
  });
  if (error) return { error: "generic" };
  revalidatePath("/settings/offers");
  revalidatePath("/sell");
  return {};
}

export async function stopOffer(id: string): Promise<{ ok: boolean }> {
  const { supabase } = await requireOwner();
  const { error } = await supabase.from("offers").update({ active: false }).eq("id", id);
  revalidatePath("/settings/offers");
  revalidatePath("/sell");
  return { ok: !error };
}
