import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/money";
import { localName } from "@/lib/names";
import { istToday } from "@/lib/period";
import { buildOrders, deadStock, fastMovers, isLow, orderText, type ReorderRow } from "@/lib/reorder";
import { requireSession } from "@/lib/session";
import { sizeLabel } from "@/lib/sizes";
import { whatsappLink } from "@/lib/slip";

const WINDOWS = [14, 30, 60];
const DEAD = [30, 60, 90];
const pick = (v: unknown, allowed: number[], fallback: number) => (allowed.includes(Number(v)) ? Number(v) : fallback);
const day = (d: string) => formatDate(`${d}T12:00:00+05:30`);

export default async function ReorderPage({ searchParams }: PageProps<"/stock/reorder">) {
  const { supabase, shop, profile } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();
  const sp = await searchParams;
  const days = pick(sp.days, WINDOWS, 30);
  const deadDays = pick(sp.dead, DEAD, 60);

  const { data } = await supabase.rpc("reorder_rows", { p_days: days });
  const rows = (data ?? []) as ReorderRow[];
  const name = (r: ReorderRow) => localName({ name: r.product, name_hi: r.product_hi, name_en: r.product_en }, locale);
  const size = (s: string) => sizeLabel(s, t);
  const href = (d: number, dd: number) => `/stock/reorder?days=${d}&dead=${dd}`;

  const low = rows.filter(isLow).sort((a, b) => a.category_sort - b.category_sort || a.product.localeCompare(b.product) || a.stock - b.stock);
  const lowByProduct = new Map<string, ReorderRow[]>();
  for (const r of low) lowByProduct.set(r.product_id, [...(lowByProduct.get(r.product_id) ?? []), r]);
  const orders = buildOrders(rows);
  const fast = fastMovers(rows, days);
  const dead = deadStock(rows, deadDays, istToday()).slice(0, 25);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/stock" className="text-brand underline underline-offset-4">
        {t("item.back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("reorder.title")}</h1>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t("reorder.window")}</span>
        {WINDOWS.map((d) => (
          <Chip key={d} href={href(d, deadDays)} active={d === days} label={t("reorder.days", { count: d })} />
        ))}
      </div>

      {/* Low stock */}
      <Section title={t("reorder.low")} hint={t("reorder.lowHint")}>
        {lowByProduct.size === 0 && <p className="text-muted">{t("reorder.noLow")}</p>}
        <ul className="flex flex-col">
          {[...lowByProduct.values()].map((sizes) => (
            <li key={sizes[0].product_id} className="border-t border-border py-2 first:border-0">
              <p className="font-semibold">{name(sizes[0])}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {sizes.map((r) => (
                  <Link
                    key={r.variant_id}
                    href={`/stock/${r.variant_id}`}
                    className={`rounded-lg px-2 py-1 text-sm font-semibold ${r.stock <= 0 ? "bg-red-100 text-danger" : "bg-warn-bg text-warn-ink"}`}
                  >
                    {size(r.size)}: {r.stock}/{r.min_stock}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Suggested orders */}
      <Section title={t("reorder.orders")} hint={t("reorder.ordersHint", { days })}>
        {orders.length === 0 && <p className="text-muted">{t("reorder.noOrders")}</p>}
        <div className="flex flex-col gap-3">
          {orders.map((o) => {
            const text = orderText(o, {
              shop: localName(shop, locale),
              greeting: t("reorder.msgGreeting"),
              closing: t("reorder.msgClosing"),
              pieces: (n) => t("reorder.pieces", { count: n }),
              name,
              size,
            });
            return (
              <article key={o.supplier_id ?? "none"} className="rounded-xl border-2 border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold">{o.supplier ?? t("reorder.unknownSupplier")}</h3>
                  <span className="shrink-0 font-semibold">{t("reorder.pieces", { count: o.total })}</span>
                </div>
                {o.phone && <p className="text-sm text-muted">{o.phone}</p>}
                <ul className="mt-2 flex flex-col gap-2">
                  {o.items.map((item) => (
                    <li key={item.product_id}>
                      <p className="font-semibold">{name(item.row)}</p>
                      <ul className="text-sm">
                        {item.lines.map((l) => (
                          <li key={l.variant_id} className="flex justify-between gap-2">
                            <span>
                              <b>
                                {size(l.size)} × {l.qty}
                              </b>
                            </span>
                            <span className="text-muted">{t("reorder.why", { sold: l.sold, stock: l.stock, min: l.min })}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <a
                  href={whatsappLink(text, o.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex min-h-12 items-center justify-center rounded-xl border-2 border-[#25d366] font-bold text-[#128c4a]"
                >
                  {o.phone ? t("reorder.send") : t("reorder.sendNoPhone")}
                </a>
              </article>
            );
          })}
        </div>
        {profile.role === "owner" && orders.length > 0 && (
          <a href={`/api/export/reorder?days=${days}`} download className="mt-2 self-start font-semibold text-brand underline">
            {t("reorder.csv")}
          </a>
        )}
      </Section>

      {/* Fast movers */}
      <Section title={t("reorder.fast")} hint={t("reorder.fastHint")}>
        <ol className="flex flex-col">
          {fast.map((p, i) => (
            <li key={p.product_id} className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-0">
              <span className="min-w-0">
                <span className="mr-2 text-muted">{i + 1}.</span>
                <span className="font-semibold">{name(p.row)}</span>
                <span className="block text-sm text-muted">{t("reorder.stockLeft", { count: p.stock })}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-bold">{t("reorder.sold", { count: p.sold })}</span>
                <span className={`text-sm font-semibold ${p.daysLeft !== null && p.daysLeft < 7 ? "text-danger" : "text-muted"}`}>
                  {t("reorder.daysLeft", { count: p.daysLeft ?? 0 })}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {/* Dead stock */}
      <Section title={t("reorder.dead")} hint={t("reorder.deadHint", { days: deadDays })}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{t("reorder.deadDays")}</span>
          {DEAD.map((d) => (
            <Chip key={d} href={href(days, d)} active={d === deadDays} label={t("reorder.days", { count: d })} />
          ))}
        </div>
        {dead.length === 0 && <p className="text-muted">{t("reorder.noDead")}</p>}
        <ul className="flex flex-col">
          {dead.map((p) => (
            <li key={p.product_id} className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-0">
              <span className="min-w-0">
                <span className="font-semibold">{name(p.row)}</span>
                <span className="block text-sm text-muted">
                  {p.last_sold ? t("reorder.lastSold", { date: day(p.last_sold) }) : t("reorder.neverSold")}
                </span>
              </span>
              <span className="shrink-0 font-semibold">{t("reorder.stockLeft", { count: p.stock })}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 items-center rounded-full border-2 px-3 text-sm font-semibold ${
        active ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface"
      }`}
    >
      {label}
    </Link>
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
