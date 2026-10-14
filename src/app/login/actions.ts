"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, toLocale } from "@/i18n/request";
import { createClient } from "@/lib/supabase/server";
import { isValidPin, normalizePhone, phoneToAuthEmail } from "@/lib/phone";

export type LoginState = { error?: "badPhone" | "badPin" | "wrong" | "inactive" } | undefined;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  const pin = String(form.get("pin") ?? "");
  if (!phone) return { error: "badPhone" };
  if (!isValidPin(pin)) return { error: "badPin" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: phoneToAuthEmail(phone),
    password: pin,
  });
  if (error || !data.user) return { error: "wrong" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("language, active")
    .eq("id", data.user.id)
    .single();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { error: "inactive" };
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, toLocale(profile.language), {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  redirect("/sell");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
