"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";

export type CloseError = "bad_amount" | "bad_date" | "generic";

export async function closeDay(input: {
  date: string;
  opening: number;
  cashOut: number;
  counted: number;
  left: number;
  notes: string;
}): Promise<{ error?: CloseError }> {
  const { supabase } = await requireSession();
  const { error } = await supabase.rpc("close_day", {
    p_date: input.date,
    p_opening: input.opening,
    p_cash_out: input.cashOut,
    p_counted: input.counted,
    p_left: input.left,
    p_notes: input.notes,
  });
  if (error) {
    return { error: error.message.includes("bad_amount") ? "bad_amount" : error.message.includes("bad_date") ? "bad_date" : "generic" };
  }
  revalidatePath("/reports/close");
  return {};
}
