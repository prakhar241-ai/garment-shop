import { getLocale, getTranslations } from "next-intl/server";
import { requireOwner } from "@/lib/session";
import { localName } from "@/lib/names";
import type { RoundingRule } from "@/lib/pricing";
import { ShopSettingsForm } from "./ShopSettingsForm";

export default async function ShopSettingsPage() {
  const { supabase, shop } = await requireOwner();
  const t = await getTranslations("settings");
  const locale = await getLocale();

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name_hi, name_en, default_markup_percent, default_min_stock")
    .is("deleted_at", null)
    .order("sort_order");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("shop")}</h1>
      <ShopSettingsForm
        rounding={(shop.settings.rounding ?? "10") as RoundingRule}
        categories={(categories ?? []).map((c) => ({
          id: c.id,
          name: localName(c, locale),
          markup: Number(c.default_markup_percent),
          minStock: c.default_min_stock,
        }))}
      />
    </div>
  );
}
