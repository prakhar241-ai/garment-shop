import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import type { RoundingRule } from "@/lib/pricing";
import { ReceiveForm, type FormCategory } from "./ReceiveForm";

export default async function NewBillPage() {
  const { supabase, profile, shop } = await requireSession();
  const t = await getTranslations("receive");
  const locale = await getLocale();

  const [{ data: suppliers }, { data: categories }] = await Promise.all([
    supabase.from("suppliers").select("id, name, phone").is("deleted_at", null).order("name"),
    supabase
      .from("categories")
      .select(
        "id, name_hi, name_en, size_type, default_markup_percent, products(id, name, name_hi, name_en, deleted_at, variants(size, selling_price, deleted_at))",
      )
      .is("deleted_at", null)
      .order("sort_order")
      .returns<FormCategory[]>(),
  ]);

  // Today in India, as YYYY-MM-DD, worked out on the server so the form
  // shows the same date on every phone.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <div className="flex flex-col gap-4">
      <Link href="/receive" className="text-brand underline underline-offset-4">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("newBill")}</h1>
      <ReceiveForm
        suppliers={suppliers ?? []}
        categories={(categories ?? []).map((c) => ({
          ...c,
          products: c.products.filter((p) => !p.deleted_at),
        }))}
        rule={(shop.settings.rounding ?? "10") as RoundingRule}
        isOwner={profile.role === "owner"}
        locale={locale}
        today={today}
      />
    </div>
  );
}
