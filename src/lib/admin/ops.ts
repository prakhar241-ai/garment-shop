// Master-panel operations. Every function takes the service-role client, so
// callers MUST first check the person is a master user (requireMaster()).
// Kept free of Next.js imports so the tests can call it directly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CATEGORIES } from "../default-categories";
import { isValidPin, normalizePhone, phoneToAuthEmail } from "../phone";
import { ROUNDING_RULES, type RoundingRule } from "../pricing";

export type AdminError = "badPhone" | "badPin" | "phoneTaken" | "nameRequired" | "codeTaken" | "badCode" | "error";
export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: AdminError };

const fail = (error: AdminError): { ok: false; error: AdminError } => ({ ok: false, error });

export async function isPlatformAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

/** Next free shop code: S1, S2, … (barcodes start with it, e.g. S2-00001). */
export async function nextShopCode(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from("shops").select("code");
  const used = (data ?? []).map((s) => /^S(\d+)$/.exec(s.code)?.[1]).filter(Boolean).map(Number);
  return `S${Math.max(0, ...used) + 1}`;
}

/** A phone can belong to one login only: a shop user or a master user. */
async function phoneFree(admin: SupabaseClient, phone: string): Promise<boolean> {
  const { data: profile } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (profile) return false;
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return !data?.users.some((u) => u.email === phoneToAuthEmail(phone));
}

type NewUser = { name: string; phone: string; pin: string };

function checkUser(u: NewUser): AdminError | { phone: string; name: string } {
  const name = u.name.trim();
  if (!name) return "nameRequired";
  const phone = normalizePhone(u.phone);
  if (!phone) return "badPhone";
  if (!isValidPin(u.pin)) return "badPin";
  return { phone, name };
}

/** Create a login for a shop (owner or staff). */
export async function addShopUser(
  admin: SupabaseClient,
  shopId: string,
  user: NewUser & { role: "owner" | "staff"; language?: "hi" | "en" },
  createdBy: string,
): Promise<Result<string>> {
  const checked = checkUser(user);
  if (typeof checked === "string") return fail(checked);
  if (!(await phoneFree(admin, checked.phone))) return fail("phoneTaken");

  const { data, error } = await admin.auth.admin.createUser({
    email: phoneToAuthEmail(checked.phone),
    password: user.pin,
    email_confirm: true,
  });
  if (error || !data.user) return fail(error?.code === "email_exists" ? "phoneTaken" : "error");

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    shop_id: shopId,
    name: checked.name,
    phone: checked.phone,
    role: user.role,
    language: user.language ?? "hi",
    created_by: createdBy,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return fail("error");
  }
  await admin.from("audit_log").insert({
    shop_id: shopId,
    action: "user_added_by_master",
    table_name: "profiles",
    row_id: data.user.id,
    details: { role: user.role, phone: checked.phone },
    created_by: createdBy,
  });
  return { ok: true, value: data.user.id };
}

export type NewShop = {
  nameHi: string;
  nameEn: string;
  code?: string;
  rounding: RoundingRule;
  language: "hi" | "en";
  seedCategories: boolean;
  owner: NewUser;
};

/** New shop with its owner (and the standard categories). All or nothing:
 *  if any step fails, what was made is removed again. */
export async function createShop(admin: SupabaseClient, input: NewShop, createdBy: string): Promise<Result<string>> {
  const nameHi = input.nameHi.trim();
  const nameEn = input.nameEn.trim();
  if (!nameHi && !nameEn) return fail("nameRequired");
  const checked = checkUser(input.owner);
  if (typeof checked === "string") return fail(checked);
  if (!(await phoneFree(admin, checked.phone))) return fail("phoneTaken");

  const code = (input.code?.trim().toUpperCase() || (await nextShopCode(admin))) as string;
  if (!/^[A-Z][A-Z0-9]{0,4}$/.test(code)) return fail("badCode");
  const { data: clash } = await admin.from("shops").select("id").eq("code", code).maybeSingle();
  if (clash) return fail("codeTaken");
  const rounding = ROUNDING_RULES.includes(input.rounding) ? input.rounding : "10";

  const { data: shop, error } = await admin
    .from("shops")
    .insert({
      name: nameHi || nameEn,
      name_hi: nameHi || null,
      name_en: nameEn || null,
      code,
      default_language: input.language,
      settings: { rounding, currency: "INR" },
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !shop) return fail(error?.code === "23505" ? "codeTaken" : "error");

  const owner = await addShopUser(admin, shop.id, { ...input.owner, role: "owner", language: input.language }, createdBy);
  if (!owner.ok) {
    await admin.from("shops").delete().eq("id", shop.id);
    return owner;
  }
  await admin.from("shops").update({ owner_id: owner.value }).eq("id", shop.id);

  if (input.seedCategories) {
    await admin.from("categories").insert(
      DEFAULT_CATEGORIES.map((c, i) => ({
        shop_id: shop.id,
        name_hi: c.name_hi,
        name_en: c.name_en,
        size_type: c.size_type,
        default_markup_percent: c.markup,
        default_min_stock: c.min_stock,
        sort_order: i,
        created_by: createdBy,
      })),
    );
  }
  await admin.from("audit_log").insert({
    shop_id: shop.id,
    action: "shop_created_by_master",
    table_name: "shops",
    row_id: shop.id,
    details: { code },
    created_by: createdBy,
  });
  return { ok: true, value: shop.id };
}

/** Set a new PIN for any shop user (or the master's own account). */
export async function resetPin(admin: SupabaseClient, userId: string, pin: string, by: string): Promise<Result> {
  if (!isValidPin(pin)) return fail("badPin");
  const { error } = await admin.auth.admin.updateUserById(userId, { password: pin });
  if (error) return fail("error");
  const { data: p } = await admin.from("profiles").select("shop_id").eq("id", userId).maybeSingle();
  if (p) {
    await admin.from("audit_log").insert({
      shop_id: p.shop_id,
      action: "pin_reset_by_master",
      table_name: "profiles",
      row_id: userId,
      created_by: by,
    });
  }
  return { ok: true, value: undefined };
}

export async function setUserActive(admin: SupabaseClient, userId: string, active: boolean, by: string): Promise<Result> {
  const { data: p, error } = await admin.from("profiles").update({ active }).eq("id", userId).select("shop_id").single();
  if (error || !p) return fail("error");
  await admin.from("audit_log").insert({
    shop_id: p.shop_id,
    action: active ? "user_activated_by_master" : "user_deactivated_by_master",
    table_name: "profiles",
    row_id: userId,
    created_by: by,
  });
  return { ok: true, value: undefined };
}

export type ShopSummary = {
  id: string;
  code: string;
  name: string;
  name_hi: string | null;
  name_en: string | null;
  created_at: string;
  owners: { name: string; phone: string }[];
  staff: number;
  inactive: number;
};

export async function listShops(admin: SupabaseClient): Promise<ShopSummary[]> {
  const [{ data: shops }, { data: people }] = await Promise.all([
    admin.from("shops").select("id, code, name, name_hi, name_en, created_at").is("deleted_at", null).order("created_at"),
    admin.from("profiles").select("shop_id, name, phone, role, active"),
  ]);
  return (shops ?? []).map((s) => {
    const mine = (people ?? []).filter((p) => p.shop_id === s.id);
    return {
      ...s,
      owners: mine.filter((p) => p.role === "owner").map((p) => ({ name: p.name, phone: p.phone })),
      staff: mine.filter((p) => p.role === "staff" && p.active).length,
      inactive: mine.filter((p) => !p.active).length,
    };
  });
}
