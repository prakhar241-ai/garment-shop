"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPin, normalizePhone, phoneToAuthEmail } from "@/lib/phone";

export type StaffState =
  | { ok?: boolean; error?: "badPhone" | "badPin" | "phoneTaken" | "error" | "nameRequired" }
  | undefined;

export async function addStaff(_prev: StaffState, form: FormData): Promise<StaffState> {
  const { profile } = await requireOwner();
  const name = String(form.get("name") ?? "").trim();
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  const pin = String(form.get("pin") ?? "");
  if (!name) return { error: "nameRequired" };
  if (!phone) return { error: "badPhone" };
  if (!isValidPin(pin)) return { error: "badPin" };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (existing) return { error: "phoneTaken" };

  const { data: created, error } = await admin.auth.admin.createUser({
    email: phoneToAuthEmail(phone),
    password: pin,
    email_confirm: true,
  });
  if (error || !created.user) {
    return { error: error?.code === "email_exists" ? "phoneTaken" : "error" };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    shop_id: profile.shop_id,
    name,
    phone,
    role: "staff",
    language: "hi",
    created_by: profile.id,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "error" };
  }

  await admin.from("audit_log").insert({
    shop_id: profile.shop_id,
    action: "staff_added",
    table_name: "profiles",
    row_id: created.user.id,
    details: { name, phone },
    created_by: profile.id,
  });
  revalidatePath("/settings/staff");
  return { ok: true };
}

export async function setStaffActive(staffId: string, active: boolean) {
  const { profile } = await requireOwner();
  const admin = createAdminClient();
  // Only staff of the owner's own shop, and never the owner's own account.
  await admin
    .from("profiles")
    .update({ active })
    .eq("id", staffId)
    .eq("shop_id", profile.shop_id)
    .eq("role", "staff");
  await admin.from("audit_log").insert({
    shop_id: profile.shop_id,
    action: active ? "staff_activated" : "staff_deactivated",
    table_name: "profiles",
    row_id: staffId,
    created_by: profile.id,
  });
  revalidatePath("/settings/staff");
}
