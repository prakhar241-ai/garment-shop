// Phase 6 against the real database in test shop B: price changes without a
// bill, offers applied by make_sale(), and the discount report.
// Offers here are limited to categories made for this run and switched off
// afterwards, so other tests' prices are never touched.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { offerPrice } from "@/lib/offers";
import { SHOP_B, adminClient, configured, ensureShopB, signIn } from "./helpers";

const r = (rupees: number) => rupees * 100;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const shift = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

describe.skipIf(!configured)("pricing discipline", () => {
  let owner: SupabaseClient;
  let staff: SupabaseClient;
  let shopId: string;
  let catA: string;
  let catB: string;
  let kurtaM: string;
  let kurtaL: string;
  let jeans: string;
  const admin = adminClient();
  const run = Date.now().toString(36);

  async function category(name: string) {
    const { data } = await admin.from("categories").insert({ shop_id: shopId, name_hi: name, name_en: name }).select("id").single();
    return data!.id as string;
  }
  async function offer(o: object) {
    const { data, error } = await owner.from("offers").insert({ starts_on: today(), ends_on: today(), ...o }).select("id").single();
    if (error) throw error;
    return data.id as string;
  }
  async function sell(client: SupabaseClient, items: object[], extra: object = {}) {
    const { data, error } = await client.rpc("make_sale", { payload: { payment_mode: "cash", items, ...extra } });
    if (error) throw new Error(error.message);
    return data as { sale_id: string; total: number };
  }
  const lines = async (saleId: string) =>
    (await admin.from("sale_items").select("variant_id, selling_price_at_sale, regular_price, offer_id").eq("sale_id", saleId)).data!;

  beforeAll(async () => {
    ({ shopId } = await ensureShopB());
    owner = await signIn(SHOP_B.owner);
    staff = await signIn(SHOP_B.staff);
    catA = await category(`Offer A ${run}`);
    catB = await category(`Offer B ${run}`);
    const { data, error } = await owner.rpc("receive_purchase", {
      payload: {
        new_supplier: { name: `Offers ${run}` },
        payment_mode: "cash",
        items: [
          { new_product: { category_id: catA, name: `Kurta ${run}` }, cost_price: r(300), selling_price: r(649), sizes: [{ size: "M", qty: 10 }, { size: "L", qty: 10 }] },
          { new_product: { category_id: catB, name: `Jeans ${run}` }, cost_price: r(500), selling_price: r(999), sizes: [{ size: "32", qty: 10 }] },
        ],
      },
    });
    if (error) throw error;
    [kurtaM, kurtaL, jeans] = data.labels.map((l: { variant_id: string }) => l.variant_id);
  }, 60_000);

  afterAll(async () => {
    await admin.from("offers").update({ active: false }).eq("shop_id", shopId);
  });

  it("SQL offer price matches the app's", async () => {
    for (const [price, kind, value] of [
      [r(649), "percent", 10],
      [r(649), "percent", 12.5],
      [r(999), "percent", 50],
      [64950, "percent", 10],
      [r(649), "fixed", r(499)],
      [r(399), "fixed", r(499)],
    ] as const) {
      const { data } = await owner.rpc("offer_price", { p_price: price, p_kind: kind, p_value: value });
      expect(data, `${kind} ${value} on ${price}`).toBe(offerPrice(price, kind, value));
    }
  });

  it("owner changes the price of one size or all sizes, with history; staff cannot", async () => {
    const { error: staffErr } = await staff.rpc("set_price", { p_variant: kurtaM, p_all_sizes: true, p_price: r(1), p_reason: "correction" });
    expect(staffErr?.message).toContain("owner_only");

    const { data, error } = await owner.rpc("set_price", { p_variant: kurtaM, p_all_sizes: false, p_price: r(699), p_reason: "increase" });
    expect(error).toBeNull();
    expect(data.changed).toEqual([kurtaM]);
    const price = async (id: string) => (await admin.from("variants").select("selling_price").eq("id", id).single()).data!.selling_price;
    expect(await price(kurtaM)).toBe(r(699));
    expect(await price(kurtaL)).toBe(r(649));

    await owner.rpc("set_price", { p_variant: kurtaM, p_all_sizes: true, p_price: r(649), p_reason: "correction" });
    expect([await price(kurtaM), await price(kurtaL)]).toEqual([r(649), r(649)]);

    const { data: hist } = await admin.from("price_changes").select("old_price, new_price, reason").eq("variant_id", kurtaM).order("created_at");
    expect(hist!.slice(-2)).toEqual([
      { old_price: r(649), new_price: r(699), reason: "increase" },
      { old_price: r(699), new_price: r(649), reason: "correction" },
    ]);
    const { error: same } = await owner.rpc("set_price", { p_variant: kurtaM, p_all_sizes: true, p_price: r(649), p_reason: "correction" });
    expect(same?.message).toContain("no_change");
  });

  it("staff cannot create offers", async () => {
    const { error } = await staff.from("offers").insert({ name: "x", kind: "percent", value: 50, starts_on: today(), ends_on: today() });
    expect(error).not.toBeNull();
  });

  it("an offer applies only to its category and its dates; the best offer wins", async () => {
    await offer({ name: `Diwali ${run}`, kind: "percent", value: 10, category_ids: [catA] });
    await offer({ name: `Old ${run}`, kind: "percent", value: 50, category_ids: [catA], starts_on: shift(today(), -10), ends_on: shift(today(), -1) });
    await offer({ name: `Later ${run}`, kind: "percent", value: 50, category_ids: [catA], starts_on: shift(today(), 1), ends_on: shift(today(), 5) });

    const sale = await sell(staff, [{ variant_id: kurtaM, qty: 1 }, { variant_id: jeans, qty: 1 }]);
    const byId = new Map((await lines(sale.sale_id)).map((l) => [l.variant_id, l]));
    expect(byId.get(kurtaM)).toMatchObject({ selling_price_at_sale: r(584), regular_price: r(649) }); // 584.10 -> 584
    expect(byId.get(kurtaM)!.offer_id).not.toBeNull();
    expect(byId.get(jeans)).toMatchObject({ selling_price_at_sale: r(999), regular_price: r(999), offer_id: null });
    expect(sale.total).toBe(r(584 + 999));

    // A fixed-price offer that is cheaper takes over; one that is dearer is ignored.
    await offer({ name: `Flat ${run}`, kind: "fixed", value: r(499), category_ids: [catA, catB] });
    await offer({ name: `Dear ${run}`, kind: "fixed", value: r(2000), category_ids: [catB] });
    const sale2 = await sell(staff, [{ variant_id: kurtaL, qty: 2 }, { variant_id: jeans, qty: 1 }]);
    expect(sale2.total).toBe(2 * r(499) + r(499));
  });

  it("owner discount still works on top of an offer; returns use today's offer price", async () => {
    const sale = await sell(owner, [{ variant_id: kurtaM, qty: 1 }], { discount: r(9) });
    expect(sale.total).toBe(r(499 - 9));
    const back = await sell(staff, [{ variant_id: kurtaM, qty: -1 }]);
    expect(back.total).toBe(-r(499));
  });

  it("a stopped offer no longer applies", async () => {
    await owner.from("offers").update({ active: false }).eq("shop_id", shopId).like("name", `%${run}`);
    const sale = await sell(staff, [{ variant_id: kurtaM, qty: 1 }]);
    expect(sale.total).toBe(r(649));
  });

  it("discount report: bill and offer discounts by staff and day; day close shows offer discounts", async () => {
    const { data } = await owner.rpc("report_discounts", { p_from: today(), p_to: today() });
    const staffRow = data.find((d: { staff: string }) => d.staff?.toLowerCase() === "staff b");
    const ownerRow = data.find((d: { staff: string }) => d.staff?.toLowerCase() === "owner b");
    // staff: kurta M 65 off + kurta L 2×150 + jeans 500 = 865 offer discount today (at least, from this run)
    expect(staffRow.offer_discount).toBeGreaterThanOrEqual(r(65 + 300 + 500));
    expect(ownerRow.bill_discount).toBeGreaterThanOrEqual(r(9));
    const { data: none } = await staff.rpc("report_discounts", { p_from: today(), p_to: today() });
    expect(none).toEqual([]);

    const { data: summary } = await owner.rpc("day_summary", { p_date: today() });
    expect(summary.offer_discounts).toBeGreaterThanOrEqual(r(65 + 300 + 500 + 150));
  });
});
