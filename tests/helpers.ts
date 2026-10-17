import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const configured = Boolean(URL && ANON && SERVICE);

export const DEMO_OWNER = { phone: "9000000001", pin: "123456" };
export const DEMO_STAFF = { phone: "9000000002", pin: "654321" };
export const SHOP_B = {
  code: "TB",
  owner: { phone: "9000000091", pin: "918273" },
  staff: { phone: "9000000092", pin: "918274" },
};

const email = (phone: string) => `p${phone}@phone-login.example.com`;

export function adminClient(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { persistSession: false } });
}

export async function signIn(user: { phone: string; pin: string }): Promise<SupabaseClient> {
  const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: email(user.phone), password: user.pin });
  if (error) throw new Error(`sign in ${user.phone}: ${error.message}`);
  return client;
}

async function ensureUser(admin: SupabaseClient, shopId: string, phone: string, pin: string, role: string) {
  const { data: existing } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await admin.auth.admin.createUser({ email: email(phone), password: pin, email_confirm: true });
  if (error) throw error;
  await admin.from("profiles").insert({ id: data.user.id, shop_id: shopId, name: `${role} B`, phone, role });
  return data.user.id;
}

/** Second shop used only by tests: owner, staff and one apparel category. */
export async function ensureShopB(): Promise<{ shopId: string; categoryId: string }> {
  const admin = adminClient();
  let { data: shop } = await admin.from("shops").select("id").eq("code", SHOP_B.code).maybeSingle();
  if (!shop) {
    ({ data: shop } = await admin
      .from("shops")
      .insert({ name: "Test Shop B", name_en: "Test Shop B", code: SHOP_B.code })
      .select("id")
      .single());
  }
  const shopId = shop!.id as string;
  const ownerId = await ensureUser(admin, shopId, SHOP_B.owner.phone, SHOP_B.owner.pin, "owner");
  await ensureUser(admin, shopId, SHOP_B.staff.phone, SHOP_B.staff.pin, "staff");
  await admin
    .from("shops")
    .update({ owner_id: ownerId, settings: { rounding: "10", currency: "INR" } })
    .eq("id", shopId);

  let { data: cat } = await admin.from("categories").select("id").eq("shop_id", shopId).limit(1).maybeSingle();
  if (!cat) {
    ({ data: cat } = await admin
      .from("categories")
      .insert({ shop_id: shopId, name_hi: "परीक्षण", name_en: "Test", default_markup_percent: 50, default_min_stock: 2 })
      .select("id")
      .single());
  }
  return { shopId, categoryId: cat!.id as string };
}
