"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, requireSession } from "@/lib/session";

export type ReceiveError =
  | "supplier_required"
  | "no_items"
  | "bad_cost"
  | "bad_amount"
  | "product_name_required"
  | "bad_price"
  | "owner_only"
  | "generic";

const KNOWN: ReceiveError[] = [
  "supplier_required",
  "no_items",
  "bad_cost",
  "bad_amount",
  "product_name_required",
  "bad_price",
  "owner_only",
];

function toError(message: string | undefined): ReceiveError {
  return KNOWN.find((k) => message?.includes(k)) ?? "generic";
}

export type ReceivePayload = {
  supplier_id?: string;
  new_supplier?: { name: string; phone?: string };
  bill_number?: string;
  bill_date?: string;
  notes?: string;
  payment_mode: "bill" | "cash" | "mixed";
  amount_paid?: number;
  items: {
    product_id?: string;
    new_product?: { category_id: string; name: string; name_hi?: string; name_en?: string };
    cost_price: number;
    selling_price?: number;
    sizes: { size: string; qty: number }[];
  }[];
};

/** Save a supplier bill. All the checks that matter happen in receive_purchase()
 *  in the database; staff prices are ignored there, not just here. */
export async function receiveBill(payload: ReceivePayload): Promise<{ error: ReceiveError } | undefined> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase.rpc("receive_purchase", { payload });
  if (error) return { error: toError(error.message) };
  revalidatePath("/receive");
  revalidatePath("/stock");
  redirect(`/labels?purchase=${(data as { purchase_id: string }).purchase_id}`);
}

export async function payBill(purchaseId: string, amount: number): Promise<{ error: ReceiveError } | undefined> {
  const { supabase } = await requireOwner();
  const { error } = await supabase.rpc("pay_purchase", { p_purchase: purchaseId, p_amount: amount });
  if (error) return { error: toError(error.message) };
  revalidatePath(`/receive/${purchaseId}`);
  revalidatePath("/receive");
}

export type CancelError = "reason_required" | "already_cancelled" | "owner_only" | "generic";

/** Owner cancels a wrongly entered bill. cancel_purchase() reverses stock and
 *  the supplier's account and keeps the bill, marked cancelled. */
export async function cancelBill(
  purchaseId: string,
  reason: string,
): Promise<{ error: CancelError } | { negative: { barcode: string; stock_qty: number }[] }> {
  const { supabase } = await requireOwner();
  const { data, error } = await supabase.rpc("cancel_purchase", { p_purchase: purchaseId, p_reason: reason });
  if (error) {
    const known: CancelError[] = ["reason_required", "already_cancelled", "owner_only"];
    return { error: known.find((k) => error.message.includes(k)) ?? "generic" };
  }
  revalidatePath(`/receive/${purchaseId}`);
  revalidatePath("/receive");
  revalidatePath("/stock");
  return { negative: (data as { negative: { barcode: string; stock_qty: number }[] }).negative };
}
