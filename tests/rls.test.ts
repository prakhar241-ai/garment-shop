// Integration tests against the real Supabase project. They prove:
//   * shop A cannot read or write shop B's data (Row Level Security)
//   * staff cannot see cost prices or change selling prices (server-side)
//   * nobody can hard-delete business records
//   * nobody can promote themselves to owner
// Needs .env.local (run npm run db:setup, db:migrate, db:seed first).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);

const email = (phone: string) => `p${phone}@phone-login.example.com`;
const SHOP_B = { code: "TB", owner: { phone: "9000000091", pin: "918273" } };

async function signIn(phone: string, pin: string): Promise<SupabaseClient> {
  const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: email(phone), password: pin });
  if (error) throw new Error(`sign in ${phone}: ${error.message}`);
  return client;
}

/** Second shop used only by these tests. Created once, reused afterwards. */
async function ensureShopB(): Promise<{ shopId: string; categoryId: string }> {
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const { data: found } = await admin.from("shops").select("id").eq("code", SHOP_B.code).maybeSingle();
  if (found) {
    const { data: cat } = await admin.from("categories").select("id").eq("shop_id", found.id).single();
    return { shopId: found.id, categoryId: cat!.id };
  }
  const { data: u, error } = await admin.auth.admin.createUser({
    email: email(SHOP_B.owner.phone),
    password: SHOP_B.owner.pin,
    email_confirm: true,
  });
  if (error) throw error;
  const { data: shop } = await admin
    .from("shops")
    .insert({ name: "Test Shop B", code: SHOP_B.code, owner_id: u.user.id })
    .select("id")
    .single();
  await admin.from("profiles").insert({
    id: u.user.id,
    shop_id: shop!.id,
    name: "Owner B",
    phone: SHOP_B.owner.phone,
    role: "owner",
  });
  const { data: cat } = await admin
    .from("categories")
    .insert({ shop_id: shop!.id, name_hi: "परीक्षण", name_en: "Test" })
    .select("id")
    .single();
  return { shopId: shop!.id, categoryId: cat!.id };
}

describe.skipIf(!configured)("row level security", () => {
  let ownerA: SupabaseClient;
  let staffA: SupabaseClient;
  let ownerB: SupabaseClient;
  let shopB: { shopId: string; categoryId: string };

  beforeAll(async () => {
    shopB = await ensureShopB();
    ownerA = await signIn("9000000001", "123456");
    staffA = await signIn("9000000002", "654321");
    ownerB = await signIn(SHOP_B.owner.phone, SHOP_B.owner.pin);
  }, 60_000);

  it("shop A sees only its own shop, people and stock", async () => {
    for (const table of ["shops", "profiles", "categories", "products"]) {
      const { data, error } = await ownerA.from(table).select("shop_id:id").limit(1000);
      expect(error, table).toBeNull();
      expect(data!.length, table).toBeGreaterThan(0);
    }
    const { data: aCats } = await ownerA.from("categories").select("shop_id");
    expect(new Set(aCats!.map((c) => c.shop_id)).size).toBe(1);
    expect(aCats!.some((c) => c.shop_id === shopB.shopId)).toBe(false);
  });

  it("shop A cannot read shop B by id", async () => {
    const { data: shop } = await ownerA.from("shops").select("id").eq("id", shopB.shopId);
    expect(shop).toEqual([]);
    const { data: cats } = await ownerA.from("categories").select("id").eq("shop_id", shopB.shopId);
    expect(cats).toEqual([]);
    const { data: costs } = await ownerA.from("owner_variant_costs").select("id").eq("shop_id", shopB.shopId);
    expect(costs).toEqual([]);
  });

  it("shop B cannot read shop A's variants", async () => {
    const { data } = await ownerB.from("variants").select("id, barcode").like("barcode", "S1-%");
    expect(data).toEqual([]);
  });

  it("shop A cannot write into shop B", async () => {
    const { error } = await ownerA
      .from("products")
      .insert({ shop_id: shopB.shopId, category_id: shopB.categoryId, name: "intruder" });
    expect(error).not.toBeNull();
  });

  it("staff cannot read cost prices, owner can", async () => {
    const staffCost = await staffA.from("variants").select("cost_price").limit(1);
    expect(staffCost.error).not.toBeNull(); // column not granted

    const staffView = await staffA.from("owner_variant_costs").select("cost_price");
    expect(staffView.data ?? []).toEqual([]);

    const staffBill = await staffA.from("purchases").select("total").limit(1);
    expect(staffBill.error).not.toBeNull();

    const ownerView = await ownerA.from("owner_variant_costs").select("cost_price").limit(5);
    expect(ownerView.error).toBeNull();
    expect(ownerView.data!.length).toBeGreaterThan(0);
    expect(ownerView.data![0].cost_price).toBeGreaterThan(0);
  });

  it("staff can read selling prices and stock", async () => {
    const { data, error } = await staffA.from("variants").select("barcode, selling_price, stock_qty").limit(3);
    expect(error).toBeNull();
    expect(data!.length).toBe(3);
  });

  it("staff cannot change a selling price", async () => {
    const { data: v } = await staffA.from("variants").select("id, selling_price").limit(1).single();
    await staffA.from("variants").update({ selling_price: 100 }).eq("id", v!.id);
    const { data: after } = await ownerA.from("variants").select("selling_price").eq("id", v!.id).single();
    expect(after!.selling_price).toBe(v!.selling_price);
  });

  it("staff cannot promote themselves to owner", async () => {
    const { data: me } = await staffA.auth.getUser();
    const { error } = await staffA.from("profiles").update({ role: "owner" }).eq("id", me.user!.id);
    expect(error).not.toBeNull();
    const { data: p } = await ownerA.from("profiles").select("role").eq("id", me.user!.id).single();
    expect(p!.role).toBe("staff");
  });

  it("nobody can hard-delete records", async () => {
    const { data: v } = await ownerA.from("products").select("id").limit(1).single();
    const { error } = await ownerA.from("products").delete().eq("id", v!.id);
    expect(error).not.toBeNull();
    const { data: still } = await ownerA.from("products").select("id").eq("id", v!.id);
    expect(still!.length).toBe(1);
  });

  it("logged-out visitors see nothing", async () => {
    const anon = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { data } = await anon.from("variants").select("id").limit(1);
    expect(data ?? []).toEqual([]);
  });
});
