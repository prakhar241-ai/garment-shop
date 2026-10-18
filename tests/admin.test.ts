// Master-panel operations against the real database. Creates a throwaway
// shop, then hides it again (soft delete) so it doesn't clutter the panel.
import { afterAll, describe, expect, it } from "vitest";
import { addShopUser, createShop, isPlatformAdmin, nextShopCode, resetPin, setUserActive } from "@/lib/admin/ops";
import { adminClient, configured, signIn } from "./helpers";

const rand = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

describe.skipIf(!configured)("master panel operations", () => {
  const admin = adminClient();
  const code = `Z${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const owner = { name: "Test Owner", phone: `7${rand(9)}`, pin: "246810" };
  const staff = { name: "Test Staff", phone: `8${rand(9)}`, pin: "135791" };
  let shopId = "";
  let staffId = "";
  const by = "00000000-0000-0000-0000-000000000000";

  afterAll(async () => {
    if (!shopId) return;
    await admin.from("profiles").update({ active: false }).eq("shop_id", shopId);
    await admin.from("shops").update({ deleted_at: new Date().toISOString() }).eq("id", shopId);
  });

  it("suggests the next S-number for a new shop", async () => {
    expect(await nextShopCode(admin)).toMatch(/^S([2-9]|\d{2,})$/);
  });

  it("creates a shop with its owner and the standard categories", async () => {
    const res = await createShop(
      admin,
      { nameHi: "टेस्ट दुकान", nameEn: "Test Shop", code, rounding: "10", language: "hi", seedCategories: true, owner },
      null as unknown as string,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    shopId = res.value;

    const client = await signIn(owner);
    const { data: shops } = await client.from("shops").select("id, code, settings");
    expect(shops).toEqual([{ id: shopId, code, settings: { rounding: "10", currency: "INR" } }]);
    const { data: cats } = await client.from("categories").select("name_en");
    expect(cats!.map((c) => c.name_en).sort()).toEqual(["Bedsheets", "Kidswear", "Sarees", "Shirts", "Undergarments"]);
    const { data: me } = await client.from("profiles").select("role");
    expect(me).toEqual([{ role: "owner" }]);
  });

  it("refuses bad input and a phone that already has a login", async () => {
    const base = { nameHi: "x", nameEn: "", rounding: "10" as const, language: "hi" as const, seedCategories: false };
    expect(await createShop(admin, { ...base, owner }, by)).toEqual({ ok: false, error: "phoneTaken" });
    expect(await createShop(admin, { ...base, code, owner: { ...owner, phone: `9${rand(9)}` } }, by)).toEqual({
      ok: false,
      error: "codeTaken",
    });
    expect(await createShop(admin, { ...base, owner: { ...owner, phone: "12345" } }, by)).toEqual({ ok: false, error: "badPhone" });
    expect(await createShop(admin, { ...base, owner: { ...owner, phone: `9${rand(9)}`, pin: "12" } }, by)).toEqual({
      ok: false,
      error: "badPin",
    });
  });

  it("adds staff who can log in to that shop only", async () => {
    const res = await addShopUser(admin, shopId, { ...staff, role: "staff" }, null as unknown as string);
    expect(res.ok).toBe(true);
    if (res.ok) staffId = res.value;
    const client = await signIn(staff);
    const { data } = await client.from("shops").select("id");
    expect(data).toEqual([{ id: shopId }]);
    expect(await addShopUser(admin, shopId, { ...staff, role: "staff" }, by)).toEqual({ ok: false, error: "phoneTaken" });
  });

  it("resets a forgotten PIN", async () => {
    expect((await resetPin(admin, staffId, "112233", null as unknown as string)).ok).toBe(true);
    await expect(signIn(staff)).rejects.toThrow();
    await expect(signIn({ ...staff, pin: "112233" })).resolves.toBeTruthy();
    expect(await resetPin(admin, staffId, "abc", by)).toEqual({ ok: false, error: "badPin" });
  });

  it("a switched-off user sees nothing", async () => {
    await setUserActive(admin, staffId, false, null as unknown as string);
    const client = await signIn({ ...staff, pin: "112233" });
    const { data } = await client.from("shops").select("id");
    expect(data).toEqual([]);
  });

  it("shop owners are not master users and cannot see who is", async () => {
    const client = await signIn(owner);
    const { data: me } = await client.auth.getUser();
    expect(await isPlatformAdmin(admin, me.user!.id)).toBe(false);
    const { data: flag } = await client.rpc("is_platform_admin");
    expect(flag).toBe(false);
    const { error } = await client.from("platform_admins").select("user_id");
    expect(error).not.toBeNull();
  });
});
