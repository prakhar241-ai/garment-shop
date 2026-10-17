import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { localName } from "@/lib/names";
import { requireSession } from "@/lib/session";
import { sizeLabel } from "@/lib/sizes";
import { fetchSellable } from "./data";
import { SellScreen, type QuickCategory, type ScanItem } from "./SellScreen";

export default async function SellPage() {
  const { supabase, profile, shop } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();

  const [variants, { data: categories }] = await Promise.all([
    fetchSellable(supabase),
    supabase.from("categories").select("id, name_hi, name_en, size_type").is("deleted_at", null).order("sort_order"),
  ]);

  // Names and sizes are resolved here, in the user's language, so scanning
  // on the phone is a plain lookup.
  const items: ScanItem[] = variants.map((v) => ({
    variantId: v.id,
    barcode: v.barcode,
    name: localName(v.product, locale),
    size: sizeLabel(v.size, t),
    price: v.selling_price,
    stock: v.stock_qty,
  }));
  const quick: QuickCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: localName(c, locale),
    sizeType: c.size_type,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("sell.title")}</h1>
        <Link href="/sell/today" className="font-semibold text-brand underline underline-offset-4">
          {t("sell.today")}
        </Link>
      </div>
      <SellScreen
        items={items}
        categories={quick}
        isOwner={profile.role === "owner"}
        shopName={localName(shop, locale)}
      />
    </div>
  );
}
