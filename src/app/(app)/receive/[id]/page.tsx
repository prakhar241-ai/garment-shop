import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { formatDate, formatPaise } from "@/lib/money";
import { localName } from "@/lib/names";
import { sizeLabel } from "@/lib/sizes";
import { CancelBill } from "./CancelBill";
import { PayForm } from "./PayForm";

type Line = {
  id: string;
  qty: number;
  variant: {
    size: string;
    barcode: string;
    selling_price: number;
    product: { name: string; name_hi: string | null; name_en: string | null };
  };
};

export default async function BillPage({ params }: PageProps<"/receive/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();
  const isOwner = profile.role === "owner";

  const { data: bill } = await supabase
    .from("purchases")
    .select(
      "id, bill_number, bill_date, payment_mode, deleted_at, cancel_reason, supplier:suppliers(name, phone)",
    )
    .eq("id", id)
    .maybeSingle<{
      id: string;
      bill_number: string | null;
      bill_date: string;
      payment_mode: string;
      deleted_at: string | null;
      cancel_reason: string | null;
      supplier: { name: string; phone: string | null } | null;
    }>();
  if (!bill) notFound();

  const cancelled = Boolean(bill.deleted_at);
  // A cancelled bill still shows what was on it.
  let lineQuery = supabase
    .from("purchase_items")
    .select(
      "id, qty, variant:variants(size, barcode, selling_price, product:products(name, name_hi, name_en))",
    )
    .eq("purchase_id", id);
  if (!cancelled) lineQuery = lineQuery.is("deleted_at", null);
  const { data: lines } = await lineQuery.order("created_at").returns<Line[]>();

  let money: { total: number; amount_paid: number } | null = null;
  const costs = new Map<string, number>();
  if (isOwner) {
    const [{ data: m }, { data: c }] = await Promise.all([
      supabase
        .from("owner_purchases")
        .select("total, amount_paid")
        .eq("id", id)
        .single(),
      supabase
        .from("owner_purchase_items")
        .select("id, cost_price")
        .eq("purchase_id", id),
    ]);
    money = m;
    for (const row of c ?? []) costs.set(row.id, row.cost_price);
  }
  const due = money ? money.total - money.amount_paid : 0;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/receive" className="text-brand underline underline-offset-4">
        {t("receive.back")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{bill.supplier?.name}</h1>
        <p className="text-muted">
          {bill.bill_number
            ? `${t("receive.billNumber")} ${bill.bill_number} · `
            : ""}
          {formatDate(bill.bill_date)}
        </p>
      </div>

      {cancelled && (
        <div
          role="status"
          className="rounded-xl border-2 border-danger bg-red-50 p-3 text-danger"
        >
          <p className="text-lg font-bold">✕ {t("cancel.cancelled")}</p>
          {bill.cancel_reason && (
            <p>{t("cancel.cancelledReason", { reason: bill.cancel_reason })}</p>
          )}
        </div>
      )}

      {!cancelled && (
        <Link
          href={`/labels?purchase=${bill.id}`}
          className="flex min-h-14 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-ink"
        >
          {t("receive.printLabels")}
        </Link>
      )}

      <ul className="flex flex-col gap-2">
        {(lines ?? []).map((l) => (
          <li
            key={l.id}
            className="rounded-xl border border-border bg-surface p-3"
          >
            <div className="flex justify-between gap-2">
              <span className="font-semibold">
                {localName(l.variant.product, locale)}
              </span>
              <span>{formatPaise(l.variant.selling_price)}</span>
            </div>
            <div className="flex justify-between gap-2 text-sm text-muted">
              <span>
                {sizeLabel(l.variant.size, t)} ·{" "}
                {t("receive.pieces", { count: l.qty })}
                {costs.has(l.id) && ` × ${formatPaise(costs.get(l.id)!)}`}
              </span>
              <span className="font-mono text-xs">{l.variant.barcode}</span>
            </div>
          </li>
        ))}
      </ul>

      {money && (
        <section className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
          <Row
            label={t("receive.billTotal")}
            value={formatPaise(money.total)}
            bold
          />
          <Row
            label={t("receive.paid")}
            value={formatPaise(money.amount_paid)}
          />
          <Row
            label={t("receive.due")}
            value={formatPaise(due)}
            danger={due > 0}
          />
          {due > 0 && !cancelled && <PayForm purchaseId={bill.id} due={due} />}
        </section>
      )}

      {isOwner && !cancelled && <CancelBill purchaseId={bill.id} />}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  danger,
}: {
  label: string;
  value: string;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${bold ? "text-lg font-bold" : ""} ${danger ? "font-semibold text-danger" : ""}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
