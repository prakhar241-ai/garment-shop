"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

export type UdhaarError = "bad_amount" | "name_required" | "bad_date" | "generic";
const KNOWN: UdhaarError[] = ["bad_amount", "name_required", "bad_date"];
const toError = (m?: string): UdhaarError => KNOWN.find((k) => m?.includes(k)) ?? "generic";

export async function addCustomer(input: {
  name: string;
  phone: string;
  opening: number | null;
  since: string | null;
}): Promise<{ error: UdhaarError } | undefined> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase.rpc("add_customer", {
    p_name: input.name,
    p_phone: input.phone,
    p_opening: input.opening,
    p_since: input.since,
  });
  if (error) return { error: toError(error.message) };
  revalidatePath("/udhaar");
  redirect(`/udhaar/${data}`);
}

/** Customer pays back. The database checks the amount against what is due. */
export async function recordPayment(
  customerId: string,
  amount: number,
  mode: "cash" | "upi",
  notes: string,
): Promise<{ error: UdhaarError } | { left: number }> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase.rpc("record_payment", {
    p_customer: customerId,
    p_amount: amount,
    p_mode: mode,
    p_notes: notes,
  });
  if (error) return { error: toError(error.message) };
  revalidatePath("/udhaar");
  revalidatePath(`/udhaar/${customerId}`);
  return { left: data as number };
}

export async function updateCustomer(customerId: string, name: string, phone: string): Promise<{ error?: UdhaarError }> {
  const { supabase } = await requireSession();
  if (!name.trim()) return { error: "name_required" };
  const { error } = await supabase
    .from("customers")
    .update({ name: name.trim(), phone: phone.trim() || null })
    .eq("id", customerId);
  if (error) return { error: "generic" };
  revalidatePath(`/udhaar/${customerId}`);
  revalidatePath("/udhaar");
  return {};
}
