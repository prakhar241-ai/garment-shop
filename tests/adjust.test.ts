// Stock adjustment, cancelling a supplier bill and the reorder data,
// against the real database in test shop B.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_OWNER, SHOP_B, adminClient, configured, ensureShopB, signIn } from "./helpers";

const r = (rupees: number) => rupees * 100;

describe.skipIf(!configured)("stock adjustment, bill cancel, reorder data", () => {
  let owner: SupabaseClient;
  let staff: SupabaseClient;
  let ownerA: SupabaseClient;
  let categoryId: string;
  const admin = adminClient();
  const run = Date.now().toString(36);

  beforeAll(async () => {
    ({ categoryId } = await ensureShopB());
    owner = await signIn(SHOP_B.owner);
    staff = await signIn(SHOP_B.staff);
    ownerA = await signIn(DEMO_OWNER);
  }, 60_000);

  const stockOf = async (id: string) => (await admin.from("variants").select("stock_qty").eq("id", id).single()).data!.stock_qty;
  async function receive(supplier: string, qty: number, mode = "bill", paid?: number) {
    const { data, error } = await owner.rpc("receive_purchase", {
      payload: {
        new_supplier: { name: supplier, phone: "9811100000" },
        payment_mode: mode,
        amount_paid: paid,
        items: [{ new_product: { category_id: categoryId, name: `Item ${supplier}` }, cost_price: r(100), sizes: [{ size: "M", qty }] }],
      },
    });
    if (error) throw error;
    const { data: bill } = await admin.from("purchases").select("supplier_id").eq("id", data.purchase_id).single();
    return { purchase: data.purchase_id as string, variant: data.labels[0].variant_id as string, supplier: bill!.supplier_id as string };
  }

  it("owner sets a counted quantity or adds/removes, with a reason", async () => {
    const { variant } = await receive(`Adj ${run}`, 10);
    const { data: left, error } = await owner.rpc("adjust_stock", { p_variant: variant, p_mode: "set", p_value: 7, p_reason: "count_correction", p_notes: "shelf count" });
    expect(error).toBeNull();
    expect(left).toBe(7);
    await owner.rpc("adjust_stock", { p_variant: variant, p_mode: "change", p_value: -2, p_reason: "damage", p_notes: null });
    expect(await stockOf(variant)).toBe(5);
    const { data: rows } = await admin.from("stock_adjustments").select("qty_change, reason").eq("variant_id", variant).order("created_at");
    expect(rows).toEqual([
      { qty_change: -3, reason: "count_correction" },
      { qty_change: -2, reason: "damage" },
    ]);
  });

  it("refuses staff, other shops, no change and bad reasons", async () => {
    const { variant } = await receive(`Adj2 ${run}`, 3);
    const call = (c: SupabaseClient, args: object) =>
      c.rpc("adjust_stock", { p_variant: variant, p_mode: "change", p_value: -1, p_reason: "damage", p_notes: null, ...args });
    expect((await call(staff, {})).error?.message).toContain("owner_only");
    expect((await call(ownerA, {})).error?.message).toContain("item_not_found");
    expect((await call(owner, { p_mode: "set", p_value: 3 })).error?.message).toContain("no_change");
    expect((await call(owner, { p_reason: "lost" })).error?.message).toContain("bad_reason");
    expect((await call(owner, { p_mode: "set", p_value: -1 })).error?.message).toContain("bad_qty");
    expect(await stockOf(variant)).toBe(3);
  });

  it("cancelling a bill takes its stock back off and reverses the supplier's account", async () => {
    // ₹100 × 5 = ₹500 bill, ₹200 paid: supplier was owed ₹300.
    const { purchase, variant, supplier } = await receive(`Cancel ${run}`, 5, "mixed", r(200));
    const balance = async () => (await admin.from("suppliers").select("balance").eq("id", supplier).single()).data!.balance;
    expect(await balance()).toBe(r(300));

    // Two were already sold before the mistake was noticed.
    await owner.rpc("make_sale", { payload: { payment_mode: "cash", items: [{ variant_id: variant, qty: 2 }] } });

    expect((await staff.rpc("cancel_purchase", { p_purchase: purchase, p_reason: "x" })).error?.message).toContain("owner_only");
    expect((await owner.rpc("cancel_purchase", { p_purchase: purchase, p_reason: " " })).error?.message).toContain("reason_required");

    const { data, error } = await owner.rpc("cancel_purchase", { p_purchase: purchase, p_reason: "entered twice" });
    expect(error).toBeNull();
    expect(data.negative).toEqual([{ barcode: expect.stringMatching(/^TB-/), stock_qty: -2 }]);
    expect(await stockOf(variant)).toBe(-2);
    // Bill gone from the account; the ₹200 already paid is now the supplier's to return.
    expect(await balance()).toBe(-r(200));

    const { data: bill } = await admin.from("purchases").select("deleted_at, cancel_reason").eq("id", purchase).single();
    expect(bill!.deleted_at).not.toBeNull();
    expect(bill!.cancel_reason).toBe("entered twice");
    const { data: lines } = await admin.from("purchase_items").select("deleted_at").eq("purchase_id", purchase);
    expect(lines!.every((l) => l.deleted_at)).toBe(true);

    expect((await owner.rpc("cancel_purchase", { p_purchase: purchase, p_reason: "again" })).error?.message).toContain("already_cancelled");
    expect((await owner.rpc("pay_purchase", { p_purchase: purchase, p_amount: 1 })).error?.message).toContain("purchase_not_found");
  });

  it("reorder data: sold in the window, last supplier, no money, works for staff", async () => {
    const { variant, supplier } = await receive(`Reorder ${run}`, 6);
    await owner.rpc("make_sale", { payload: { payment_mode: "cash", items: [{ variant_id: variant, qty: 4 }] } });
    const { data, error } = await staff.rpc("reorder_rows", { p_days: 30 });
    expect(error).toBeNull();
    const row = data.find((x: { variant_id: string }) => x.variant_id === variant);
    expect(row).toMatchObject({ stock: 2, sold: 4, supplier_id: supplier, supplier: `Reorder ${run}`, supplier_phone: "9811100000" });
    expect(Object.keys(row).some((k) => /cost|price|total|balance/.test(k))).toBe(false);

    const { data: other } = await ownerA.rpc("reorder_rows", { p_days: 30 });
    expect(other.some((x: { variant_id: string }) => x.variant_id === variant)).toBe(false);
  });
});
