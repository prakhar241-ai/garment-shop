import { getLocale, getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { formatPaise } from "@/lib/money";
import { localName } from "@/lib/names";

type Variant = {
  id: string;
  size: string;
  barcode: string;
  selling_price: number;
  stock_qty: number;
  min_stock: number;
};
type Product = {
  id: string;
  name: string;
  name_hi: string | null;
  name_en: string | null;
  variants: Variant[];
};
type Category = {
  id: string;
  name_hi: string;
  name_en: string;
  products: Product[];
};

export default async function StockPage() {
  const { supabase, profile } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();
  const isOwner = profile.role === "owner";

  // Columns are listed explicitly: staff are not granted SELECT on cost_price,
  // so "select *" would be refused by the database for them.
  const { data: categories } = await supabase
    .from("categories")
    .select(
      "id, name_hi, name_en, products(id, name, name_hi, name_en, variants(id, size, barcode, selling_price, stock_qty, min_stock))",
    )
    .is("deleted_at", null)
    .order("sort_order")
    .returns<Category[]>();

  // Cost is only fetched for owners, through the owner-only view.
  let costValue: number | null = null;
  if (isOwner) {
    const { data: costs } = await supabase
      .from("owner_variant_costs")
      .select("cost_price, stock_qty");
    costValue = (costs ?? []).reduce((sum, v) => sum + v.cost_price * Math.max(v.stock_qty, 0), 0);
  }

  const all = (categories ?? []).flatMap((c) => c.products.flatMap((p) => p.variants));
  const totalUnits = all.reduce((s, v) => s + v.stock_qty, 0);
  const lowCount = all.filter((v) => v.stock_qty <= v.min_stock).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t("stock.title")}</h1>
        <p className="text-muted">{t("stock.intro")}</p>
      </div>

      <div className={`grid gap-2 ${isOwner ? "grid-cols-3" : "grid-cols-2"}`}>
        <Stat label={t("stock.totalUnits")} value={String(totalUnits)} />
        <Stat label={t("stock.lowStock")} value={String(lowCount)} warn={lowCount > 0} />
        {costValue !== null && <Stat label={t("stock.costValue")} value={formatPaise(costValue)} />}
      </div>

      {(categories ?? []).length === 0 && <p className="text-muted">{t("stock.empty")}</p>}

      {(categories ?? []).map((cat) => (
        <section key={cat.id} className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">
            {localName(cat, locale)}{" "}
            <span className="text-base font-normal text-muted">
              · {t("common.items", { count: cat.products.length })}
            </span>
          </h2>
          {cat.products.map((p) => (
            <article key={p.id} className="rounded-xl border border-border bg-surface p-3">
              <h3 className="text-lg font-semibold">{localName(p, locale)}</h3>
              <ul className="mt-2 grid grid-cols-2 gap-2">
                {p.variants
                  .toSorted((a, b) => a.barcode.localeCompare(b.barcode))
                  .map((v) => {
                    const low = v.stock_qty <= v.min_stock;
                    return (
                      <li
                        key={v.id}
                        className={`rounded-lg px-3 py-2 ${low ? "bg-warn-bg text-warn-ink" : "bg-background"}`}
                      >
                        <div className="flex justify-between font-semibold">
                          <span>{v.size}</span>
                          <span>{formatPaise(v.selling_price)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>
                            {t("common.stock")}: {v.stock_qty}
                          </span>
                          <span className="font-mono text-xs opacity-70">{v.barcode}</span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${warn ? "bg-warn-bg text-warn-ink" : "bg-surface"} border border-border`}>
      <p className="text-sm leading-snug">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
