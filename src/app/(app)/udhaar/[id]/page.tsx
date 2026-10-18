import Link from "next/link";
import { notFound } from "next/navigation";
import { createTranslator } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import hiMessages from "../../../../../messages/hi.json";
import enMessages from "../../../../../messages/en.json";
import { ageBucket, daysSince } from "@/lib/aging";
import { formatDate, formatPaise } from "@/lib/money";
import { localName } from "@/lib/names";
import { requireSession } from "@/lib/session";
import { sizeLabel } from "@/lib/sizes";
import { whatsappLink } from "@/lib/slip";
import { EditCustomer, PaymentForm } from "./CustomerForms";

type Entry = {
  id: string;
  entry_type: "credit_sale" | "payment";
  amount: number;
  entry_date: string;
  is_opening: boolean;
  payment_mode: "cash" | "upi" | null;
  sale_id: string | null;
  notes: string | null;
};

type Line = {
  sale_id: string;
  qty: number;
  size: string | null;
  description: string | null;
  variant: {
    product: { name: string; name_hi: string | null; name_en: string | null };
  } | null;
};

export default async function CustomerPage({
  params,
}: PageProps<"/udhaar/[id]">) {
  const { id } = await params;
  const { supabase, shop } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();

  const { data: c } = await supabase
    .from("customer_aging")
    .select("id, name, phone, outstanding, oldest_unpaid, last_payment")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const { data: entries } = await supabase
    .from("credit_entries")
    .select(
      "id, entry_type, amount, entry_date, is_opening, payment_mode, sale_id, notes",
    )
    .eq("customer_id", id)
    .is("deleted_at", null)
    .order("entry_date")
    .order("created_at")
    .returns<Entry[]>();

  // What was bought on each udhaar sale, so the account reads like the notebook.
  const saleIds = (entries ?? []).flatMap((e) =>
    e.sale_id ? [e.sale_id] : [],
  );
  const { data: lines } = saleIds.length
    ? await supabase
        .from("sale_items")
        .select(
          "sale_id, qty, size, description, variant:variants(product:products(name, name_hi, name_en))",
        )
        .in("sale_id", saleIds)
        .returns<Line[]>()
    : { data: [] as Line[] };
  const bought = new Map<string, string[]>();
  for (const l of lines ?? []) {
    const name = l.variant
      ? localName(l.variant.product, locale)
      : (l.description ?? "");
    const label = `${name}${l.size ? ` ${sizeLabel(l.size, t)}` : ""} × ${Math.abs(l.qty)}`;
    bought.set(l.sale_id, [...(bought.get(l.sale_id) ?? []), label]);
  }

  // Running balance, oldest first; shown newest first.
  const history: (Entry & { balance: number })[] = [];
  for (const e of entries ?? []) {
    const before = history.at(-1)?.balance ?? 0;
    history.push({
      ...e,
      balance: before + (e.entry_type === "credit_sale" ? e.amount : -e.amount),
    });
  }
  history.reverse();

  const days = c.oldest_unpaid ? daysSince(c.oldest_unpaid) : null;
  const bucket = days === null ? null : ageBucket(days);

  // Reminder in either language, whatever the app is showing right now.
  const reminders = (["hi", "en"] as const).map((lang) => {
    const r = createTranslator({
      locale: lang,
      messages: lang === "hi" ? hiMessages : enMessages,
      namespace: "reminder",
    });
    return {
      lang,
      href: whatsappLink(
        r("text", {
          name: c.name,
          amount: formatPaise(c.outstanding),
          shop: localName(shop, lang),
        }),
        c.phone,
      ),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/udhaar" className="text-brand underline underline-offset-4">
        {t("udhaar.back")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        {c.phone && (
          <a
            href={`tel:${c.phone}`}
            className="text-lg text-brand underline underline-offset-4"
          >
            {c.phone}
          </a>
        )}
      </div>

      <section
        className={`rounded-2xl p-4 ${
          c.outstanding <= 0
            ? "bg-surface"
            : bucket === "old"
              ? "bg-red-50 text-danger"
              : bucket === "late"
                ? "bg-warn-bg text-warn-ink"
                : "bg-surface"
        } border border-border`}
      >
        <p className="text-base">{t("udhaar.owes")}</p>
        <p className="text-4xl font-bold">
          {c.outstanding > 0 ? formatPaise(c.outstanding) : t("udhaar.settled")}
        </p>
        {days !== null && (
          <p className="text-base font-semibold">
            {days === 0 ? t("udhaar.today") : t("udhaar.days", { count: days })}
          </p>
        )}
        <p className="text-sm opacity-80">
          {c.last_payment
            ? t("udhaar.lastPaid", { date: formatDate(c.last_payment) })
            : t("udhaar.neverPaid")}
        </p>
      </section>

      {c.outstanding > 0 && (
        <PaymentForm customerId={c.id} due={c.outstanding} />
      )}

      {c.outstanding > 0 &&
        (c.phone ? (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">{t("udhaar.remind")}</h2>
            <div className="grid grid-cols-2 gap-2">
              {reminders.map((r) => (
                <a
                  key={r.lang}
                  href={r.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-12 items-center justify-center rounded-xl border-2 border-[#25d366] font-bold text-[#128c4a]"
                >
                  {r.lang === "hi"
                    ? t("udhaar.remindHi")
                    : t("udhaar.remindEn")}
                </a>
              ))}
            </div>
          </section>
        ) : (
          <p className="rounded-xl bg-warn-bg p-3 text-warn-ink">
            {t("udhaar.noPhone")}
          </p>
        ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t("udhaar.history")}</h2>
        <ul className="flex flex-col gap-2">
          {history.map((e) => {
            const credit = e.entry_type === "credit_sale";
            const title = e.is_opening
              ? t("udhaar.openingEntry")
              : credit
                ? t("udhaar.sale")
                : e.sale_id
                  ? t("udhaar.returnCredit")
                  : `${t("udhaar.payment")}${e.payment_mode ? ` · ${t(`udhaar.${e.payment_mode}`)}` : ""}`;
            return (
              <li
                key={e.id}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{title}</span>
                  <span className={`font-bold ${credit ? "" : "text-brand"}`}>
                    {credit ? "+" : "−"}
                    {formatPaise(e.amount)}
                  </span>
                </div>
                {e.sale_id && bought.has(e.sale_id) && (
                  <p className="text-sm">{bought.get(e.sale_id)!.join(", ")}</p>
                )}
                {e.notes && !e.is_opening && (
                  <p className="text-sm text-muted">{e.notes}</p>
                )}
                <div className="flex justify-between gap-2 text-sm text-muted">
                  <span>{formatDate(e.entry_date)}</span>
                  <span>
                    {t("udhaar.balance", { amount: formatPaise(e.balance) })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <EditCustomer customerId={c.id} name={c.name} phone={c.phone ?? ""} />
    </div>
  );
}
