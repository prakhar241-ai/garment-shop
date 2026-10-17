// Receiving stock through receive_purchase(), against the real database, in
// test shop B so the demo shop's numbers stay put.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { suggestSellingPrice, type RoundingRule } from "@/lib/pricing";
import { DEMO_OWNER, SHOP_B, adminClient, configured, ensureShopB, signIn } from "./helpers";

const r = (rupees: number) => rupees * 100;

describe.skipIf(!configured)("receiving stock", () => {
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

  async function receive(client: SupabaseClient, payload: object) {
    const { data, error } = await client.rpc("receive_purchase", { payload });
    if (error) throw new Error(error.message);
    return data as { purchase_id: string; labels: { variant_id: string; qty: number }[] };
  }

  async function variant(id: string) {
    const { data } = await admin.from("variants").select("*").eq("id", id).single();
    return data!;
  }

  it("SQL price suggestion matches the app's", async () => {
    const rules: RoundingRule[] = ["10", "49_99", "99", "9", "none"];
    for (const rule of rules) {
      for (const [cost, markup] of [
        [r(300), 50],
        [r(299), 40],
        [44901, 35],
        [r(1), 45],
        [r(2500), 37.5],
        [0, 50],
      ] as const) {
        const { data } = await owner.rpc("suggest_price", { cost, markup, rule });
        expect(data, `${rule} ${cost} ${markup}`).toBe(suggestSellingPrice(cost, markup, rule));
      }
    }
  });

  it("staff receive a new product: barcodes, stock and the suggested ₹10-rounded price", async () => {
    const res = await receive(staff, {
      new_supplier: { name: `Supplier ${run}`, phone: "9811111111" },
      bill_number: `B-${run}`,
      payment_mode: "bill",
      items: [
        {
          new_product: { category_id: categoryId, name: `शर्ट ${run}` },
          cost_price: r(303),
          selling_price: r(1), // staff price must be ignored
          sizes: [
            { size: "M", qty: 3 },
            { size: "L", qty: 2 },
            { size: "XL", qty: 0 }, // skipped
          ],
        },
      ],
    });
    expect(res.labels.map((l) => l.qty)).toEqual([3, 2]);

    const m = await variant(res.labels[0].variant_id);
    expect(m.stock_qty).toBe(3);
    expect(m.barcode).toMatch(/^TB-\d{5}$/);
    const { data: cat } = await admin.from("categories").select("default_markup_percent").eq("id", categoryId).single();
    expect(m.selling_price).toBe(suggestSellingPrice(r(303), Number(cat!.default_markup_percent), "10"));
    expect(m.selling_price % 1000).toBe(0); // whole ₹10
    expect(m.cost_price).toBe(r(303));

    const { data: bill } = await admin.from("purchases").select("total, amount_paid, supplier_id").eq("id", res.purchase_id).single();
    expect(bill!.total).toBe(r(303) * 5);
    expect(bill!.amount_paid).toBe(0);
    const { data: sup } = await admin.from("suppliers").select("balance").eq("id", bill!.supplier_id).single();
    expect(sup!.balance).toBe(r(303) * 5);
  });

  it("receiving an existing size adds stock; staff cannot change its price, owner can", async () => {
    const first = await receive(owner, {
      new_supplier: { name: `Supplier2 ${run}` },
      payment_mode: "cash",
      items: [{ new_product: { category_id: categoryId, name: `Kurta ${run}` }, cost_price: r(200), sizes: [{ size: "S", qty: 4 }] }],
    });
    const id = first.labels[0].variant_id;
    const { data: p } = await admin.from("variants").select("product_id, selling_price").eq("id", id).single();
    const before = p!.selling_price;

    await receive(staff, {
      new_supplier: { name: `Supplier3 ${run}` },
      payment_mode: "cash",
      items: [{ product_id: p!.product_id, cost_price: r(220), selling_price: r(5), sizes: [{ size: "S", qty: 2 }] }],
    });
    let v = await variant(id);
    expect(v.stock_qty).toBe(6);
    expect(v.selling_price).toBe(before);
    expect(v.cost_price).toBe(r(220)); // latest cost is remembered

    await receive(owner, {
      new_supplier: { name: `Supplier4 ${run}` },
      payment_mode: "cash",
      items: [{ product_id: p!.product_id, cost_price: r(220), selling_price: r(399), sizes: [{ size: "S", qty: 1 }] }],
    });
    v = await variant(id);
    expect(v.stock_qty).toBe(7);
    expect(v.selling_price).toBe(r(399));
    const { data: changes } = await admin
      .from("price_changes")
      .select("old_price, new_price, reason")
      .eq("variant_id", id)
      .order("created_at");
    expect(changes!.at(-1)).toEqual({ old_price: before, new_price: r(399), reason: "correction" });
  });

  it("part payment, later payment and supplier balance", async () => {
    const res = await receive(owner, {
      new_supplier: { name: `Supplier5 ${run}` },
      payment_mode: "mixed",
      amount_paid: r(100),
      items: [{ new_product: { category_id: categoryId, name: `Dupatta ${run}` }, cost_price: r(150), sizes: [{ size: "Free", qty: 2 }] }],
    });
    const { data: bill } = await admin.from("purchases").select("supplier_id").eq("id", res.purchase_id).single();
    const balance = async () =>
      (await admin.from("suppliers").select("balance").eq("id", bill!.supplier_id).single()).data!.balance;
    expect(await balance()).toBe(r(200));

    const { error: tooMuch } = await owner.rpc("pay_purchase", { p_purchase: res.purchase_id, p_amount: r(201) });
    expect(tooMuch?.message).toContain("bad_amount");

    const { error: staffPay } = await staff.rpc("pay_purchase", { p_purchase: res.purchase_id, p_amount: r(50) });
    expect(staffPay?.message).toContain("owner_only");

    const { error } = await owner.rpc("pay_purchase", { p_purchase: res.purchase_id, p_amount: r(200) });
    expect(error).toBeNull();
    expect(await balance()).toBe(0);
  });

  it("rejects paying more than the bill and empty bills", async () => {
    await expect(
      receive(owner, {
        new_supplier: { name: `Supplier6 ${run}` },
        payment_mode: "mixed",
        amount_paid: r(999),
        items: [{ new_product: { category_id: categoryId, name: `X ${run}` }, cost_price: r(10), sizes: [{ size: "M", qty: 1 }] }],
      }),
    ).rejects.toThrow("bad_amount");
    await expect(
      receive(owner, { new_supplier: { name: "Nobody" }, payment_mode: "cash", items: [] }),
    ).rejects.toThrow("no_items");
  });

  it("staff cannot read supplier balances or bill totals", async () => {
    const { data: view } = await staff.from("owner_suppliers").select("balance");
    expect(view ?? []).toEqual([]);
    const { error } = await staff.from("suppliers").select("balance").limit(1);
    expect(error).not.toBeNull();
    const { data: names, error: nameErr } = await staff.from("suppliers").select("id, name").limit(1);
    expect(nameErr).toBeNull();
    expect(names!.length).toBe(1);
  });

  it("another shop cannot receive into this shop's products or categories", async () => {
    const { data: prod } = await admin.from("products").select("id").eq("category_id", categoryId).limit(1).single();
    await expect(
      receive(ownerA, {
        new_supplier: { name: "Intruder" },
        payment_mode: "cash",
        items: [{ product_id: prod!.id, cost_price: r(1), sizes: [{ size: "M", qty: 1 }] }],
      }),
    ).rejects.toThrow("product_not_found");
    await expect(
      receive(ownerA, {
        new_supplier: { name: "Intruder" },
        payment_mode: "cash",
        items: [{ new_product: { category_id: categoryId, name: "x" }, cost_price: r(1), sizes: [{ size: "M", qty: 1 }] }],
      }),
    ).rejects.toThrow("category_not_found");
  });
});
