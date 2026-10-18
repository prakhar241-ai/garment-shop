import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate, formatPaise } from "@/lib/money";
import { localName } from "@/lib/names";
import { buckets, resolvePeriod, type PeriodKey } from "@/lib/period";
import { requireSession } from "@/lib/session";
import { sizeLabel } from "@/lib/sizes";

type SalesRow = { bucket: string; bills: number; gross: number; returns: number; discounts: number; net: number; cost: number; margin: number };
type CatRow = { category_id: string; name_hi: string; name_en: string; qty: number; net: number; cost: number; margin: number };
type SizeRow = { size: string; qty: number; net: number };
type ProdRow = { product_id: string; name: string; name_hi: string | null; name_en: string | null; sold: number; net: number; stock: number; last_sold: string | null };
type StockRow = { stock: number; cost_value: number; sale_value: number };

const PERIODS: PeriodKey[] = ["today", "yesterday", "7d", "30d", "month", "lastMonth"];
const day = (d: string) => formatDate(`${d}T12:00:00+05:30`);

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { supabase, profile } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();

  const closeCard = (
    <Link href="/reports/close" className="flex min-h-16 flex-col justify-center rounded-2xl bg-brand px-4 py-3 text-brand-ink">
      <span className="text-lg font-bold">{t("reports.closeCard")} →</span>
      <span className="text-sm opacity-90">{t("reports.closeCardHint")}</span>
    </Link>
  );

  if (profile.role !== "owner") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{t("reports.title")}</h1>
        {closeCard}
        <p className="text-muted">{t("reports.ownerOnly")}</p>
      </div>
    );
  }

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const period = resolvePeriod(str(sp.p), str(sp.from), str(sp.to));
  const range = { p_from: period.from, p_to: period.to };

  const [sales, cats, sizes, prods, stock] = await Promise.all([
    supabase.rpc("report_sales", { ...range, p_grain: period.grain }),
    supabase.rpc("report_categories", range),
    supabase.rpc("report_sizes", range),
    supabase.rpc("report_products", range),
    supabase.rpc("report_stock"),
  ]);

  const rows = (sales.data ?? []) as SalesRow[];
  const sum = (k: keyof SalesRow) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const net = sum("net");
  const margin = sum("margin");
  const bills = sum("bills");
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  const series = buckets(period.from, period.to, period.grain).map((b) => ({ key: b, value: byBucket.get(b)?.net ?? 0 }));
  const products = (prods.data ?? []) as ProdRow[];
  const top = products.filter((p) => p.sold > 0).toSorted((a, b) => b.sold - a.sold || b.net - a.net).slice(0, 10);
  const slow = products
    .filter((p) => p.stock > 0 && p.sold <= 0)
    .toSorted((a, b) => (a.last_sold ?? "").localeCompare(b.last_sold ?? "") || b.stock - a.stock)
    .slice(0, 10);
  const stockRows = (stock.data ?? []) as StockRow[];
  const units = stockRows.reduce((s, r) => s + Math.max(r.stock, 0), 0);
  const query = period.key === "custom" ? `p=custom&from=${period.from}&to=${period.to}` : `p=${period.key}`;
  const pct = (m: number, n: number) => (n > 0 ? ((m / n) * 100).toFixed(1) : "0");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">{t("reports.title")}</h1>
      {closeCard}

      {/* Period */}
      <nav className="flex flex-wrap gap-2" aria-label={t("csv.period")}>
        {PERIODS.map((k) => (
          <Link
            key={k}
            href={`/reports?p=${k}`}
            aria-current={period.key === k ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${
              period.key === k ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface"
            }`}
          >
            {t(`reports.p.${k}`)}
          </Link>
        ))}
      </nav>
      <form className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" action="/reports">
        <input type="hidden" name="p" value="custom" />
        <label className="flex flex-col text-sm">
          {t("reports.from")}
          <input type="date" name="from" defaultValue={period.from} className="min-h-11 rounded-lg border-2 border-border bg-surface px-2" />
        </label>
        <label className="flex flex-col text-sm">
          {t("reports.to")}
          <input type="date" name="to" defaultValue={period.to} className="min-h-11 rounded-lg border-2 border-border bg-surface px-2" />
        </label>
        <button type="submit" className="min-h-11 rounded-lg border-2 border-brand px-3 font-semibold text-brand">
          {t("reports.show")}
        </button>
      </form>
      <p className="-mt-3 text-sm text-muted">
        {day(period.from)} – {day(period.to)}
      </p>

      {/* Headline numbers */}
      <section className="grid grid-cols-2 gap-2">
        <Tile label={t("reports.net")} value={formatPaise(net)} big />
        <Tile label={t("reports.margin")} value={formatPaise(margin)} sub={t("reports.marginOf", { pct: pct(margin, net) })} big />
        <Tile label={t("reports.bills")} value={String(bills)} />
        <Tile label={t("reports.avgBill")} value={formatPaise(bills ? Math.round(net / bills) : 0)} />
        <Tile label={t("reports.discounts")} value={formatPaise(sum("discounts"))} />
        <Tile label={t("reports.returns")} value={formatPaise(sum("returns"))} />
      </section>

      {rows.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-border p-4 text-center text-muted">{t("reports.noData")}</p>
      ) : (
        <>
          <Section title={t(`reports.byTime.${period.grain}`)}>
            <Bars
              items={series.map((s) => ({
                key: s.key,
                label: period.grain === "month" ? s.key.slice(0, 7).split("-").reverse().join("/") : day(s.key).slice(0, 5),
                value: s.value,
                text: formatPaise(s.value),
              }))}
            />
          </Section>

          <Section title={t("reports.byCategory")}>
            <table className="w-full text-left text-base">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="py-1 font-semibold">{t("reports.category")}</th>
                  <th className="py-1 text-right font-semibold">{t("reports.sales")}</th>
                  <th className="py-1 text-right font-semibold">{t("reports.marginPct")}</th>
                </tr>
              </thead>
              <tbody>
                {((cats.data ?? []) as CatRow[]).map((c) => (
                  <tr key={c.category_id} className="border-t border-border">
                    <td className="py-2">
                      <span className="block font-semibold">{localName(c, locale)}</span>
                      <span className="text-sm text-muted">{t("reports.pieces", { count: c.qty })}</span>
                    </td>
                    <td className="py-2 text-right font-semibold">{formatPaise(c.net)}</td>
                    <td className="py-2 text-right">
                      <span className="block font-semibold">{pct(c.margin, c.net)}%</span>
                      <span className="text-sm text-muted">{formatPaise(c.margin)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={t("reports.bySize")}>
            <Bars
              items={((sizes.data ?? []) as SizeRow[]).map((s) => ({
                key: s.size,
                label: s.size === "—" ? "—" : sizeLabel(s.size, t),
                value: s.qty,
                text: `${t("reports.pieces", { count: s.qty })} · ${formatPaise(s.net)}`,
              }))}
            />
          </Section>

          <Section title={t("reports.top")}>
            <ol className="flex flex-col">
              {top.map((p, i) => (
                <li key={p.product_id} className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-0">
                  <span className="min-w-0">
                    <span className="mr-2 text-muted">{i + 1}.</span>
                    <span className="font-semibold">{localName(p, locale)}</span>
                    <span className="block text-sm text-muted">{t("reports.inStock", { count: p.stock })}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-bold">{t("reports.sold", { count: p.sold })}</span>
                    <span className="text-sm text-muted">{formatPaise(p.net)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      <Section title={t("reports.slow")} hint={t("reports.slowHint")}>
        <ul className="flex flex-col">
          {slow.map((p) => (
            <li key={p.product_id} className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-0">
              <span className="min-w-0">
                <span className="font-semibold">{localName(p, locale)}</span>
                <span className="block text-sm text-muted">
                  {p.last_sold ? t("reports.lastSold", { date: day(p.last_sold) }) : t("reports.neverSold")}
                </span>
              </span>
              <span className="shrink-0 font-semibold">{t("reports.inStock", { count: p.stock })}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("reports.stockValue")}>
        <div className="grid grid-cols-2 gap-2">
          <Tile label={t("reports.atCost")} value={formatPaise(stockRows.reduce((s, r) => s + r.cost_value, 0))} big />
          <Tile label={t("reports.atPrice")} value={formatPaise(stockRows.reduce((s, r) => s + r.sale_value, 0))} />
        </div>
        <p className="mt-1 text-sm text-muted">{t("reports.units", { count: units })}</p>
      </Section>

      <Section title={t("reports.export")} hint={t("reports.exportHint")}>
        <div className="grid grid-cols-2 gap-2">
          {(["sales", "daily", "categories", "products", "purchases", "closes", "stock", "udhaar"] as const).map((k) => (
            <a
              key={k}
              href={`/api/export/${k}?${query}`}
              download
              className="flex min-h-12 items-center justify-center rounded-xl border-2 border-brand px-2 text-center text-sm font-semibold text-brand"
            >
              ⬇ {t(`reports.csv.${k}`)}
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-sm text-muted">{label}</p>
      <p className={`${big ? "text-2xl" : "text-lg"} font-bold`}>{value}</p>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </div>
  );
}

/** Horizontal bars, one series. Every bar carries its value as text, so the
 *  list doubles as the table view and nothing depends on colour. */
function Bars({ items }: { items: { key: string; label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[4.5rem_1fr] items-center gap-2" title={`${i.label}: ${i.text}`}>
          <span className="truncate text-sm text-muted">{i.label}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-4 rounded-r bg-brand"
              style={{ width: `${Math.max(0, (i.value / max) * 70)}%`, minWidth: i.value > 0 ? 3 : 0 }}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold whitespace-nowrap">{i.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
