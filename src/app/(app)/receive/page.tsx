import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { formatDate, formatPaise } from "@/lib/money";

type Bill = {
  id: string;
  bill_number: string | null;
  bill_date: string;
  supplier: { name: string } | null;
  purchase_items: { qty: number }[];
};

export default async function ReceivePage() {
  const { supabase, profile } = await requireSession();
  const t = await getTranslations("receive");
  const isOwner = profile.role === "owner";

  const { data: bills } = await supabase
    .from("purchases")
    .select("id, bill_number, bill_date, supplier:suppliers(name), purchase_items(qty)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<Bill[]>();

  // Money is owner-only and comes from the owner views.
  const money = new Map<string, { total: number; amount_paid: number }>();
  let dues: { id: string; name: string; balance: number }[] = [];
  if (isOwner) {
    const ids = (bills ?? []).map((b) => b.id);
    const [{ data: totals }, { data: sup }] = await Promise.all([
      supabase.from("owner_purchases").select("id, total, amount_paid").in("id", ids),
      supabase.from("owner_suppliers").select("id, name, balance").gt("balance", 0).order("balance", { ascending: false }),
    ]);
    for (const row of totals ?? []) money.set(row.id, row);
    dues = sup ?? [];
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
      </div>

      <Link
        href="/receive/new"
        className="flex min-h-14 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-ink"
      >
        {t("newBill")}
      </Link>

      {isOwner && (
        <section className="rounded-2xl border border-border bg-surface p-3">
          <h2 className="text-lg font-bold">{t("supplierDues")}</h2>
          {dues.length === 0 ? (
            <p className="text-muted">{t("noDues")}</p>
          ) : (
            <ul>
              {dues.map((s) => (
                <li key={s.id} className="flex justify-between py-1">
                  <span>{s.name}</span>
                  <b>{formatPaise(s.balance)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t("recent")}</h2>
        {(bills ?? []).length === 0 && <p className="text-muted">{t("noBills")}</p>}
        {(bills ?? []).map((b) => {
          const m = money.get(b.id);
          const pcs = b.purchase_items.reduce((s, i) => s + i.qty, 0);
          return (
            <Link key={b.id} href={`/receive/${b.id}`} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex justify-between gap-2">
                <span className="truncate text-lg font-semibold">{b.supplier?.name}</span>
                <span className="shrink-0 text-muted">{formatDate(b.bill_date)}</span>
              </div>
              <div className="flex justify-between gap-2 text-sm">
                <span>
                  {b.bill_number ? `#${b.bill_number} · ` : ""}
                  {t("pieces", { count: pcs })}
                </span>
                {m && (
                  <span>
                    {formatPaise(m.total)}
                    {m.total > m.amount_paid && (
                      <span className="text-danger"> · {t("due")} {formatPaise(m.total - m.amount_paid)}</span>
                    )}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
