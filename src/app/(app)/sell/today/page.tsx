import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatPaise } from "@/lib/money";
import { localName } from "@/lib/names";
import { requireSession } from "@/lib/session";

type Sale = {
  id: string;
  sold_at: string;
  payment_mode: "cash" | "upi" | "udhaar";
  total: number;
  discount_total: number;
  is_return: boolean;
  staff_id: string | null;
  customer: { name: string } | null;
  sale_items: { qty: number }[];
};

/** Start of today in India, as an ISO timestamp. */
function startOfTodayIST(): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

export default async function TodayPage() {
  const { supabase } = await requireSession();
  const t = await getTranslations("sell");
  const locale = await getLocale();

  const { data: sales } = await supabase
    .from("sales")
    .select(
      "id, sold_at, payment_mode, total, discount_total, is_return, staff_id, customer:customers(name), sale_items(qty)",
    )
    .gte("sold_at", startOfTodayIST())
    .is("deleted_at", null)
    .order("sold_at", { ascending: false })
    .returns<Sale[]>();

  const { data: people } = await supabase.from("profiles").select("id, name, name_hi, name_en");
  const staffName = new Map((people ?? []).map((p) => [p.id, localName(p, locale)]));

  const list = sales ?? [];
  const byMode = { cash: 0, upi: 0, udhaar: 0 };
  for (const s of list) byMode[s.payment_mode] += s.total;
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sell" className="text-brand underline underline-offset-4">
        {t("back")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{t("todayTitle")}</h1>
        <p className="text-muted">{t("salesCount", { count: list.length })}</p>
      </div>

      <section className="grid grid-cols-3 gap-2">
        {(["cash", "upi", "udhaar"] as const).map((m) => (
          <div key={m} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-sm">{t(m)}</p>
            <p className="text-lg font-bold">{formatPaise(byMode[m])}</p>
          </div>
        ))}
      </section>

      {list.length === 0 && <p className="text-muted">{t("noSales")}</p>}
      <ul className="flex flex-col gap-2">
        {list.map((s) => (
          <li key={s.id} className={`rounded-xl border bg-surface p-3 ${s.is_return ? "border-danger" : "border-border"}`}>
            <div className="flex justify-between gap-2">
              <span className="text-muted">{time.format(new Date(s.sold_at))}</span>
              <span className={`text-lg font-bold ${s.total < 0 ? "text-danger" : ""}`}>{formatPaise(s.total)}</span>
            </div>
            <div className="flex justify-between gap-2 text-sm">
              <span>
                {s.is_return && `↩ ${t("returned")} · `}
                {s.sale_items.reduce((n, i) => n + Math.abs(i.qty), 0)} · {t(s.payment_mode)}
                {s.customer && ` · ${s.customer.name}`}
              </span>
              <span className="text-muted">{s.staff_id ? staffName.get(s.staff_id) : ""}</span>
            </div>
            {s.discount_total > 0 && (
              <p className="text-sm text-warn-ink">
                {t("discount")} {formatPaise(s.discount_total)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
