"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addShopUser, createShop, resetPin, setUserActive, type AdminError, type NewShop } from "@/lib/admin/ops";
import { requireMaster } from "@/lib/session";

// Every action re-checks that the caller is a master user before touching
// anything with the service-role client.

export async function createShopAction(input: NewShop): Promise<{ error: AdminError } | undefined> {
  const { user, admin } = await requireMaster();
  const res = await createShop(admin, input, user.id);
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin");
  redirect(`/admin/shops/${res.value}`);
}

export async function addUserAction(
  shopId: string,
  input: { name: string; phone: string; pin: string; role: "owner" | "staff" },
): Promise<{ error?: AdminError }> {
  const { user, admin } = await requireMaster();
  const res = await addShopUser(admin, shopId, input, user.id);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/admin/shops/${shopId}`);
  revalidatePath("/admin");
  return {};
}

export async function resetPinAction(userId: string, pin: string, shopId?: string): Promise<{ error?: AdminError }> {
  const { user, admin } = await requireMaster();
  const res = await resetPin(admin, userId, pin, user.id);
  if (!res.ok) return { error: res.error };
  if (shopId) revalidatePath(`/admin/shops/${shopId}`);
  return {};
}

/** The master changes their own PIN. */
export async function resetMyPinAction(pin: string): Promise<{ error?: AdminError }> {
  const { user, admin } = await requireMaster();
  const res = await resetPin(admin, user.id, pin, user.id);
  return res.ok ? {} : { error: res.error };
}

export async function setActiveAction(userId: string, active: boolean, shopId: string): Promise<{ error?: AdminError }> {
  const { user, admin } = await requireMaster();
  const res = await setUserActive(admin, userId, active, user.id);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/admin/shops/${shopId}`);
  revalidatePath("/admin");
  return {};
}

/** A random 6-digit PIN suggestion for a new login. */
export async function suggestPin(): Promise<string> {
  await requireMaster();
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
