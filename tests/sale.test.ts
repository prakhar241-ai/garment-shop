// Selling through make_sale(), against the real database, in test shop B.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_OWNER, SHOP_B, adminClient, configured, ensureShopB, signIn } from "./helpers";

const r = (rupees: number) => rupees * 100;

type SaleResult = {
  sale_id: string;
  subtotal: number;
  discount: number;
  total: number;
  stock: { variant_id: string; stock_qty: number }[];
  negative: { barcode: string; stock_qty: number }[];
  error?: string;
};

describe.skipIf(!configured)("selling", () => {
  let owner: SupabaseClient;
  let staff: SupabaseClient;
  let ownerA: SupabaseClient;
  let categoryId: string;
  let shopId: string;
  let shirt: string; // variant id, price known
  let jeans: string;
  let shirtPrice: number;
  let jeansPrice: number;
  const admin = adminClient();
  const run = Date.now().toString(36);

  const clearPinFailures = () => admin.from("audit_log").delete().eq("shop_id", shopId).eq("action", "owner_pin_failed");

  beforeAll(async () => {
    ({ categoryId, shopId } = await ensureShopB());
    await clearPinFailures();
    owner = await signIn(SHOP_B.owner);
    staff = await signIn(SHOP_B.staff);
    ownerA = await signIn(DEMO_OWNER);

    const { data, error } = await owner.rpc("receive_purchase", {
      payload: {
        new_supplier: { name: `Sale test ${run}` },
        payment_mode: "cash",
        items: [
          { new_product: { category_id: categoryId, name: `Shirt ${run}` }, cost_price: r(200), selling_price: r(400), sizes: [{ size: "M", qty: 3 }] },
          { new_product: { category_id: categoryId, name: `Jeans ${run}` }, cost_price: r(500), selling_price: r(900), sizes: [{ size: "L", qty: 1 }] },
        ],
      },
    });
    if (error) throw error;
    [shirt, jeans] = data.labels.map((l: { variant_id: string }) => l.variant_id);
    shirtPrice = r(400);
    jeansPrice = r(900);
  }, 60_000);

  afterAll(clearPinFailures);

  async function sell(client: SupabaseClient, payload: object): Promise<SaleResult> {
    const { data, error } = await client.rpc("make_sale", { payload });
    if (error) throw new Error(error.message);
    return data as SaleResult;
  }
  const stockOf = async (id: string) => (await admin.from("variants").select("stock_qty").eq("id", id).single()).data!.stock_qty;

  it("uses the database price and reduces stock", async () => {
    const res = await sell(staff, { payment_mode: "cash", items: [{ variant_id: shirt, qty: 2, price: 1 }] });
    expect(res.total).toBe(2 * shirtPrice);
    expect(await stockOf(shirt)).toBe(1);
    const { data: lines } = await admin.from("sale_items").select("selling_price_at_sale, cost_price_at_sale").eq("sale_id", res.sale_id);
    expect(lines).toEqual([{ selling_price_at_sale: shirtPrice, cost_price_at_sale: r(200) }]);
  });

  it("selling more than in stock is allowed and reported", async () => {
    const res = await sell(staff, { payment_mode: "upi", items: [{ variant_id: jeans, qty: 2 }] });
    expect(res.negative).toEqual([{ barcode: expect.stringMatching(/^TB-/), stock_qty: -1 }]);
    expect(await stockOf(jeans)).toBe(-1);
  });

  it("return puts stock back and gives money back", async () => {
    const res = await sell(staff, { payment_mode: "cash", items: [{ variant_id: jeans, qty: -1 }] });
    expect(res.total).toBe(-jeansPrice);
    expect(await stockOf(jeans)).toBe(0);
    const { data: sale } = await admin.from("sales").select("is_return").eq("id", res.sale_id).single();
    expect(sale!.is_return).toBe(true);
  });

  it("exchange nets the two items", async () => {
    const res = await sell(staff, {
      payment_mode: "cash",
      items: [
        { variant_id: shirt, qty: -1 },
        { variant_id: jeans, qty: 1 },
      ],
    });
    expect(res.total).toBe(jeansPrice - shirtPrice);
    expect(await stockOf(shirt)).toBe(2);
    expect(await stockOf(jeans)).toBe(-1);
  });

  it("quick sale of an untagged item uses the typed price", async () => {
    const res = await sell(staff, {
      payment_mode: "cash",
      items: [{ category_id: categoryId, size: "XL", price: r(250), qty: 2, description: "no tag" }],
    });
    expect(res.total).toBe(r(500));
    await expect(sell(staff, { payment_mode: "cash", items: [{ category_id: categoryId, price: 0, qty: 1 }] })).rejects.toThrow(
      "bad_price",
    );
  });

  it("discount: owner can give it; staff need the owner's PIN", async () => {
    const byOwner = await sell(owner, { payment_mode: "cash", discount: r(50), items: [{ variant_id: shirt, qty: 1 }] });
    expect(byOwner.total).toBe(shirtPrice - r(50));

    const noPin = await sell(staff, { payment_mode: "cash", discount: r(50), items: [{ variant_id: shirt, qty: 1 }] });
    expect(noPin.error).toBe("bad_pin");
    const wrong = await sell(staff, { payment_mode: "cash", discount: r(50), owner_pin: "000000", items: [{ variant_id: shirt, qty: 1 }] });
    expect(wrong.error).toBe("bad_pin");
    expect(await stockOf(shirt)).toBe(1); // refused sales changed nothing

    const ok = await sell(staff, {
      payment_mode: "cash",
      discount: r(40),
      owner_pin: SHOP_B.owner.pin,
      items: [{ variant_id: shirt, qty: 1 }],
    });
    expect(ok.total).toBe(shirtPrice - r(40));
    const { data: sale } = await admin.from("sales").select("discount_total, discount_approved_by").eq("id", ok.sale_id).single();
    const { data: ownerRow } = await admin.from("profiles").select("id").eq("phone", SHOP_B.owner.phone).single();
    expect(sale).toEqual({ discount_total: r(40), discount_approved_by: ownerRow!.id });

    await expect(sell(owner, { payment_mode: "cash", discount: r(5000), items: [{ variant_id: shirt, qty: 1 }] })).rejects.toThrow(
      "bad_discount",
    );
  });

  it("udhaar needs a customer and moves their balance both ways", async () => {
    await expect(sell(staff, { payment_mode: "udhaar", items: [{ variant_id: jeans, qty: 1 }] })).rejects.toThrow("customer_required");

    const res = await sell(staff, {
      payment_mode: "udhaar",
      new_customer: { name: `Ramesh ${run}`, phone: "98765 43210" },
      items: [{ variant_id: jeans, qty: 1 }],
    });
    const { data: sale } = await admin.from("sales").select("customer_id").eq("id", res.sale_id).single();
    const outstanding = async () =>
      (await admin.from("customers").select("outstanding, phone").eq("id", sale!.customer_id).single()).data!;
    expect(await outstanding()).toEqual({ outstanding: jeansPrice, phone: "9876543210" });

    await sell(staff, { payment_mode: "udhaar", customer_id: sale!.customer_id, items: [{ variant_id: jeans, qty: -1 }] });
    expect((await outstanding()).outstanding).toBe(0);
  });

  it("sales cannot be written directly, only through make_sale", async () => {
    const { error } = await staff.from("sales").insert({ payment_mode: "cash", total: 1 });
    expect(error).not.toBeNull();
  });

  it("another shop cannot sell this shop's stock", async () => {
    await expect(sell(ownerA, { payment_mode: "cash", items: [{ variant_id: shirt, qty: 1 }] })).rejects.toThrow("item_not_found");
  });

  it("five wrong PINs lock discounts for a while, even with the right PIN", async () => {
    await clearPinFailures();
    for (let i = 0; i < 5; i++) {
      const res = await sell(staff, { payment_mode: "cash", discount: r(1), owner_pin: "11111" + i, items: [{ variant_id: shirt, qty: 1 }] });
      expect(res.error).toBe("bad_pin");
    }
    const locked = await sell(staff, {
      payment_mode: "cash",
      discount: r(1),
      owner_pin: SHOP_B.owner.pin,
      items: [{ variant_id: shirt, qty: 1 }],
    });
    expect(locked.error).toBe("pin_locked");
  });
});
