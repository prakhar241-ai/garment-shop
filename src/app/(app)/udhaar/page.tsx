import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatPaise } from "@/lib/money";
import { requireSession } from "@/lib/session";
import { CustomerList, type Row } from "./CustomerList";

export default async function UdhaarPage() {
  const { supabase } = await requireSession();
  const t = await getTranslations("udhaar");

  const { data } = await supabase
    .from("customer_aging")
    .select("id, name, phone, outstanding, oldest_unpaid, last_payment")
    .order("outstanding", { ascending: false })
    .limit(2000)
    .returns<Row[]>();
  const rows = data ?? [];
  const owing = rows.filter((r) => r.outstanding > 0);
  const total = owing.reduce((s, r) => s + r.outstanding, 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <section className="rounded-2xl bg-brand p-4 text-brand-ink">
        <p className="text-base opacity-90">{t("totalOut")}</p>
        <p className="text-4xl font-bold">{formatPaise(total)}</p>
        <p className="text-base opacity-90">{t("customersOwing", { count: owing.length })}</p>
      </section>

      <Link
        href="/udhaar/new"
        className="flex min-h-14 items-center justify-center rounded-xl border-2 border-dashed border-brand text-lg font-bold text-brand"
      >
        {t("addCustomer")}
      </Link>

      <CustomerList rows={rows} />
    </div>
  );
}
