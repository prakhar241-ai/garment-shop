import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Role = "owner" | "staff";

export type Profile = {
  id: string;
  shop_id: string;
  name: string;
  phone: string;
  role: Role;
  language: "hi" | "en";
  active: boolean;
};

export type Shop = { id: string; name: string; code: string; settings: { rounding?: string } };

/** The logged-in user's profile and shop, or a redirect to /login. Cached per request. */
export const requireSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, shop_id, name, phone, role, language, active")
    .eq("id", user.id)
    .single<Profile>();
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, code, settings")
    .eq("id", profile.shop_id)
    .single<Shop>();

  return { supabase, user, profile, shop: shop! };
});

/** Same as requireSession, but only owners get through. */
export async function requireOwner() {
  const session = await requireSession();
  if (session.profile.role !== "owner") redirect("/sell");
  return session;
}
