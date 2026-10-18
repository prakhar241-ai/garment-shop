// Udhaar: opening balances, udhaar sales, payments and the aging view,
// against the real database in test shop B.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_OWNER, SHOP_B, adminClient, configured, ensureShopB, signIn } from "./helpers";

const r = (rupees: number) => rupees * 100;
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
};

describe.skipIf(!configured)("udhaar", () => {
  let staff: SupabaseClient;
  let ownerA: SupabaseClient;
  let categoryId: string;
  let customer: string;
  const admin = adminClient();
  const run = Date.now().toString(36);

  beforeAll(async () => {
    ({ categoryId } = await ensureShopB());
    staff = await signIn(SHOP_B.staff);
    ownerA = await signIn(DEMO_OWNER);
  }, 60_000);

  const aging = async () =>
    (await staff.from("customer_aging").select("outstanding, oldest_unpaid, last_payment").eq("id", customer).single()).data!;

  it("a customer can start with udhaar carried over from the notebook", async () => {
    const { data, error } = await staff.rpc("add_customer", {
      p_name: `Kamla ${run}`,
      p_phone: "+91 99887 76655",
      p_opening: r(500),
      p_since: daysAgo(40),
    });
    expect(error).toBeNull();
    customer = data;
    const a = await aging();
    expect(a.outstanding).toBe(r(500));
    expect(a.oldest_unpaid.slice(0, 10)).toBe(new Date(`${daysAgo(40)}T00:00:00+05:30`).toISOString().slice(0, 10));
    const { data: c } = await admin.from("customers").select("phone").eq("id", customer).single();
    expect(c!.phone).toBe("9988776655");
  });

  it("an udhaar sale adds to it", async () => {
    const { error } = await staff.rpc("make_sale", {
      payload: {
        payment_mode: "udhaar",
        customer_id: customer,
        items: [{ category_id: categoryId, price: r(300), qty: 1 }],
      },
    });
    expect(error).toBeNull();
    expect((await aging()).outstanding).toBe(r(800));
  });

  it("payments go to the oldest udhaar first", async () => {
    const { data: left, error } = await staff.rpc("record_payment", {
      p_customer: customer,
      p_amount: r(600),
      p_mode: "upi",
      p_notes: "part",
    });
    expect(error).toBeNull();
    expect(left).toBe(r(200));
    const a = await aging();
    expect(a.outstanding).toBe(r(200));
    // The 40-day-old opening balance is cleared; what is left is from today's sale.
    expect(Date.now() - new Date(a.oldest_unpaid).getTime()).toBeLessThan(86_400_000);
    expect(a.last_payment).not.toBeNull();

    const { data: entry } = await admin
      .from("credit_entries")
      .select("payment_mode, amount")
      .eq("customer_id", customer)
      .eq("entry_type", "payment")
      .single();
    expect(entry).toEqual({ payment_mode: "upi", amount: r(600) });
  });

  it("cannot pay more than owed, or nothing", async () => {
    for (const amount of [r(201), 0, -5]) {
      const { error } = await staff.rpc("record_payment", { p_customer: customer, p_amount: amount, p_mode: "cash", p_notes: null });
      expect(error?.message).toContain("bad_amount");
    }
  });

  it("paying in full clears the 'since' date", async () => {
    await staff.rpc("record_payment", { p_customer: customer, p_amount: r(200), p_mode: "cash", p_notes: null });
    const a = await aging();
    expect(a.outstanding).toBe(0);
    expect(a.oldest_unpaid).toBeNull();
  });

  it("nobody can type a balance in directly", async () => {
    const { error } = await staff.from("customers").update({ outstanding: 0 }).eq("id", customer);
    expect(error).not.toBeNull();
    const { error: insertError } = await staff.from("customers").insert({ name: "x", outstanding: -100 });
    expect(insertError).not.toBeNull();
    const { error: nameError } = await staff.from("customers").update({ name: `Kamla Devi ${run}` }).eq("id", customer);
    expect(nameError).toBeNull();
  });

  it("another shop cannot see or collect from this customer", async () => {
    const { data } = await ownerA.from("customer_aging").select("id").eq("id", customer);
    expect(data).toEqual([]);
    const { error } = await ownerA.rpc("record_payment", { p_customer: customer, p_amount: 1, p_mode: "cash", p_notes: null });
    expect(error?.message).toContain("customer_not_found");
  });
});
