import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/money";
import { localName } from "@/lib/names";
import { requireMaster } from "@/lib/session";
import { AddUserForm, UserActions } from "../../AdminForms";

export default async function AdminShopPage({ params }: PageProps<"/admin/shops/[id]">) {
  const { id } = await params;
  const { admin } = await requireMaster();
  const t = await getTranslations();
  const locale = await getLocale();

  const { data: shop } = await admin
    .from("shops")
    .select("id, code, name, name_hi, name_en, settings, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!shop) notFound();
  const { data: people } = await admin
    .from("profiles")
    .select("id, name, name_hi, name_en, phone, role, active")
    .eq("shop_id", id)
    .order("role")
    .order("name");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin" className="text-brand underline underline-offset-4">
        {t("admin.back")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{localName(shop, locale)}</h1>
        <p className="text-muted">
          {t("admin.code")} <b className="font-mono text-foreground">{shop.code}</b> · {t(`settings.round_${shop.settings?.rounding ?? "10"}`)} ·{" "}
          {t("admin.created", { date: formatDate(shop.created_at) })}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{t("admin.people")}</h2>
        <ul className="flex flex-col gap-2">
          {(people ?? []).map((p) => (
            <li key={p.id} className={`flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 ${p.active ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{localName(p, locale)}</span>
                  <span className="text-sm text-muted">{p.phone}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 text-sm font-semibold ${
                    p.active ? (p.role === "owner" ? "bg-brand text-brand-ink" : "bg-background") : "bg-red-100 text-danger"
                  }`}
                >
                  {p.active ? (p.role === "owner" ? t("admin.roleOwner") : t("admin.roleStaff")) : t("admin.off")}
                </span>
              </div>
              <UserActions userId={p.id} name={localName(p, locale)} active={p.active} shopId={id} />
            </li>
          ))}
        </ul>
      </section>

      <AddUserForm shopId={id} />
    </div>
  );
}
