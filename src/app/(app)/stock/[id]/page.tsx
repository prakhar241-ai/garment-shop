import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate, formatPaise } from "@/lib/money";
import { localName } from "@/lib/names";
import { requireSession } from "@/lib/session";
import { sizeLabel } from "@/lib/sizes";
import { AdjustForm, MinStockForm } from "./ItemForms";
import { PriceForm } from "./PriceForm";

type Move = { key: string; at: string; qty: number; label: string; note?: string | null };

export default async function StockItemPage({ params }: PageProps<"/stock/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();
  const isOwner = profile.role === "owner";

  const { data: v } = await supabase
    .from("variants")
    .select("id, product_id, barcode, size, selling_price, stock_qty, min_stock, product:products(name, name_hi, name_en)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<{
      id: string;
      product_id: string;
      barcode: string;
      size: string;
      selling_price: number;
      stock_qty: number;
      min_stock: number;
      product: { name: string; name_hi: string | null; name_en: string | null };
    }>();
  if (!v) notFound();

  const [{ data: prices }, { data: siblings }, { data: people }] = await Promise.all([
    supabase
      .from("price_changes")
      .select("id, old_price, new_price, reason, created_at, created_by")
      .eq("variant_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("variants").select("id").eq("product_id", v.product_id).is("deleted_at", null),
    supabase.from("profiles").select("id, name, name_hi, name_en"),
  ]);
  const who = new Map((people ?? []).map((p) => [p.id, localName(p, locale)]));

  const [{ data: buys }, { data: sales }, { data: adjustments }, cost] = await Promise.all([
    supabase
      .from("purchase_items")
      .select("id, qty, created_at, purchase:purchases(bill_date, deleted_at, supplier:suppliers(name))")
      .eq("variant_id", id)
      .returns<{ id: string; qty: number; created_at: string; purchase: { bill_date: string; deleted_at: string | null; supplier: { name: string } | null } }[]>(),
    supabase.from("sale_items").select("id, qty, created_at").eq("variant_id", id).is("deleted_at", null),
    supabase.from("stock_adjustments").select("id, qty_change, reason, notes, created_at").eq("variant_id", id),
    isOwner ? supabase.from("owner_variant_costs").select("cost_price").eq("id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // Everything that moved this size's stock, newest first.
  const moves: Move[] = [
    ...(buys ?? []).flatMap((b) => {
      const received: Move = {
        key: `b${b.id}`,
        at: b.created_at,
        qty: b.qty,
        label: t("item.h.purchase", { supplier: b.purchase.supplier?.name ?? "—" }),
      };
      return b.purchase.deleted_at
        ? [received, { key: `c${b.id}`, at: b.purchase.deleted_at, qty: -b.qty, label: t("item.h.cancelled") }]
        : [received];
    }),
    ...(sales ?? []).map((s) => ({
      key: `s${s.id}`,
      at: s.created_at,
      qty: -s.qty,
      label: s.qty < 0 ? t("item.h.return") : t("item.h.sale"),
    })),
    ...(adjustments ?? []).map((a) => ({
      key: `a${a.id}`,
      at: a.created_at,
      qty: a.qty_change,
      label: t("item.h.adjust", { reason: t(`item.reasons.${a.reason}`) }),
      note: a.notes,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40);

  const low = v.stock_qty <= v.min_stock;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/stock" className="text-brand underline underline-offset-4">
        {t("item.back")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{localName(v.product, locale)}</h1>
        <p className="text-lg">
          {sizeLabel(v.size, t)} · <span className="font-mono text-base">{v.barcode}</span>
        </p>
      </div>

      <section className={`grid gap-2 ${isOwner ? "grid-cols-2" : "grid-cols-3"}`}>
        <Tile label={t("item.stock")} value={String(v.stock_qty)} warn={low} />
        <Tile label={t("item.min")} value={String(v.min_stock)} />
        <Tile label={t("item.price")} value={formatPaise(v.selling_price)} />
        {isOwner && cost.data && <Tile label={t("item.cost")} value={formatPaise(cost.data.cost_price)} />}
      </section>

      <Link
        href={`/labels?v=${v.id}:1`}
        className="flex min-h-14 items-center justify-center rounded-xl border-2 border-brand text-lg font-bold text-brand"
      >
        {t("item.printLabel")}
      </Link>

      {isOwner && <PriceForm variantId={v.id} price={v.selling_price} sizes={siblings?.length ?? 1} />}
      {isOwner && <AdjustForm variantId={v.id} stock={v.stock_qty} />}
      {isOwner && <MinStockForm variantId={v.id} min={v.min_stock} />}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t("price.history")}</h2>
        {(prices ?? []).length === 0 && <p className="text-muted">{t("price.noHistory")}</p>}
        <ul className="flex flex-col gap-1">
          {(prices ?? []).map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <span className="min-w-0">
                <span className="block font-semibold">{t(`price.reasons.${p.reason}`)}</span>
                <span className="text-sm text-muted">
                  {formatDate(p.created_at)}
                  {p.created_by && who.get(p.created_by) ? ` · ${who.get(p.created_by)}` : ""}
                </span>
              </span>
              <span className="shrink-0 font-semibold">
                {p.reason === "initial"
                  ? formatPaise(p.new_price)
                  : t("price.line", { old: formatPaise(p.old_price), new: formatPaise(p.new_price) })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t("item.history")}</h2>
        {moves.length === 0 && <p className="text-muted">{t("item.noHistory")}</p>}
        <ul className="flex flex-col gap-1">
          {moves.map((m) => (
            <li key={m.key} className="flex items-start justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <span className="min-w-0">
                <span className="block font-semibold">{m.label}</span>
                <span className="text-sm text-muted">
                  {formatDate(m.at)}
                  {m.note ? ` · ${m.note}` : ""}
                </span>
              </span>
              <span className={`shrink-0 text-lg font-bold ${m.qty < 0 ? "text-danger" : "text-brand"}`}>
                {m.qty > 0 ? "+" : "−"}
                {Math.abs(m.qty)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border border-border p-3 ${warn ? "bg-warn-bg text-warn-ink" : "bg-surface"}`}>
      <p className="text-sm">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
