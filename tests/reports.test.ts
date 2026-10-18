// Daily close and reports, against the real database in test shop B.
// Shop B already has sales from other tests today, so day numbers are checked
// as before/after differences, and category reports use a fresh category.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { SHOP_B, adminClient, configured, ensureShopB, signIn } from "./helpers";

const r = (rupees: number) => rupees * 100;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

type Summary = Record<string, number>;

describe.skipIf(!configured)("daily close and reports", () => {
  let owner: SupabaseClient;
  let staff: SupabaseClient;
  let shopId: string;
  let catId: string;
  let variant: string;
  let before: Summary;
  const admin = adminClient();
  const run = Date.now().toString(36);

  const summary = async (client: SupabaseClient): Promise<Summary> => {
    const { data, error } = await client.rpc("day_summary", { p_date: today() });
    if (error) throw error;
    return data;
  };

  beforeAll(async () => {
    ({ shopId } = await ensureShopB());
    owner = await signIn(SHOP_B.owner);
    staff = await signIn(SHOP_B.staff);
    const { data: cat } = await admin
      .from("categories")
      .insert({ shop_id: shopId, name_hi: `रिपोर्ट ${run}`, name_en: `Report ${run}`, default_markup_percent: 100 })
      .select("id")
      .single();
    catId = cat!.id;
    const { data } = await owner.rpc("receive_purchase", {
      payload: {
        new_supplier: { name: `Report supplier ${run}` },
        payment_mode: "cash",
        items: [{ new_product: { category_id: catId, name: `Kurti ${run}` }, cost_price: r(200), selling_price: r(400), sizes: [{ size: "M", qty: 3 }] }],
      },
    });
    variant = data.labels[0].variant_id;
    before = await summary(staff);

    // Today: one cash sale with a ₹40 discount, one UPI sale, one udhaar
    // sale paid back ₹100 in cash.
    const sale = (payload: object) => owner.rpc("make_sale", { payload });
    await sale({ payment_mode: "cash", discount: r(40), items: [{ variant_id: variant, qty: 1 }] });
    await sale({ payment_mode: "upi", items: [{ variant_id: variant, qty: 1 }] });
    const { data: cust } = await owner.rpc("add_customer", { p_name: `Report cust ${run}`, p_phone: "", p_opening: 0, p_since: null });
    await sale({ payment_mode: "udhaar", customer_id: cust, items: [{ category_id: catId, price: r(150), qty: 1 }] });
    await owner.rpc("record_payment", { p_customer: cust, p_amount: r(100), p_mode: "cash", p_notes: null });
  }, 90_000);

  it("day summary adds up by payment mode", async () => {
    const after = await summary(staff);
    const diff = (k: string) => after[k] - before[k];
    expect(diff("bills")).toBe(3);
    expect(diff("cash")).toBe(r(360));
    expect(diff("upi")).toBe(r(400));
    expect(diff("udhaar_sales")).toBe(r(150));
    expect(diff("discounts")).toBe(r(40));
    expect(diff("udhaar_given")).toBe(r(150));
    expect(diff("udhaar_collected_cash")).toBe(r(100));
  });

  it("close: expected cash = opening + cash sales + udhaar cash − cash out", async () => {
    const s = await summary(staff);
    const { data, error } = await staff.rpc("close_day", {
      p_date: today(),
      p_opening: r(1000),
      p_cash_out: r(250),
      p_counted: r(1000) + s.cash + s.udhaar_collected_cash - r(250) - r(30),
      p_left: r(500),
      p_notes: "test",
    });
    expect(error).toBeNull();
    expect(data.expected_cash).toBe(r(1000) + s.cash + s.udhaar_collected_cash - r(250));
    expect(data.difference).toBe(-r(30));

    // Closing again the same day updates the same row.
    await staff.rpc("close_day", { p_date: today(), p_opening: r(1000), p_cash_out: 0, p_counted: r(5), p_left: 0, p_notes: null });
    const { data: rows } = await admin.from("daily_closes").select("id").eq("shop_id", shopId).eq("close_date", today());
    expect(rows!.length).toBe(1);

    const { error: bad } = await staff.rpc("close_day", { p_date: today(), p_opening: 0, p_cash_out: 0, p_counted: r(1), p_left: r(2), p_notes: null });
    expect(bad?.message).toContain("bad_amount");
  });

  it("category margin spreads the bill discount over the lines", async () => {
    const { data } = await owner.rpc("report_categories", { p_from: today(), p_to: today() });
    const row = data.find((c: { category_id: string }) => c.category_id === catId);
    // Kurti: 400 - 40 discount = 360 net, 400 net; quick item 150 (no cost).
    expect(row).toMatchObject({ qty: 3, net: r(360 + 400 + 150), cost: r(400), margin: r(510) });
  });

  it("products report shows sold and stock left", async () => {
    const { data } = await owner.rpc("report_products", { p_from: today(), p_to: today() });
    const row = data.find((p: { name: string }) => p.name === `Kurti ${run}`);
    expect(row).toMatchObject({ sold: 2, stock: 1, last_sold: today() });
  });

  it("stock report values stock at cost", async () => {
    const { data } = await owner.rpc("report_stock");
    const row = data.find((v: { variant_id: string }) => v.variant_id === variant);
    expect(row).toMatchObject({ stock: 1, cost_value: r(200), sale_value: r(400) });
  });

  it("staff get nothing from owner reports", async () => {
    for (const [fn, args] of [
      ["report_stock", {}],
      ["report_categories", { p_from: today(), p_to: today() }],
      ["report_sales", { p_from: today(), p_to: today(), p_grain: "day" }],
      ["report_sale_lines", { p_from: today(), p_to: today() }],
    ] as const) {
      const { data, error } = await staff.rpc(fn, args);
      expect(error, fn).toBeNull();
      expect(data, fn).toEqual([]);
    }
  });

  it("sales by day matches the day summary", async () => {
    const { data } = await owner.rpc("report_sales", { p_from: today(), p_to: today(), p_grain: "day" });
    const s = await summary(owner);
    expect(data).toHaveLength(1);
    expect(data[0].net).toBe(s.net_sales);
    expect(data[0].bills).toBe(s.bills);
  });
});
