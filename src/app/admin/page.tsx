import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listShops } from "@/lib/admin/ops";
import { formatDate } from "@/lib/money";
import { localName } from "@/lib/names";
import { requireMaster } from "@/lib/session";
import { MyPinForm } from "./AdminForms";

export default async function AdminHome() {
  const { admin } = await requireMaster();
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const shops = await listShops(admin);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/shops/new"
        className="flex min-h-14 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-ink"
      >
        {t("newShop")}
      </Link>

      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">
          {t("shops")} <span className="text-lg font-normal text-muted">({shops.length})</span>
        </h1>
        {shops.length === 0 && <p className="text-muted">{t("noShops")}</p>}
        <ul className="flex flex-col gap-2">
          {shops.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/shops/${s.id}`} className="block rounded-xl border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold">{localName(s, locale)}</span>
                    <span className="block text-sm text-muted">
                      {t("owner")}: {s.owners.map((o) => `${o.name} · ${o.phone}`).join(", ") || "—"}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-background px-2 py-0.5 font-mono font-bold">{s.code}</span>
                </div>
                <p className="mt-1 text-sm">
                  {t("staffCount", { count: s.staff })}
                  {s.inactive > 0 && <span className="text-danger"> · {t("inactiveCount", { count: s.inactive })}</span>}
                  <span className="text-muted"> · {t("created", { date: formatDate(s.created_at) })}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <MyPinForm />
    </div>
  );
}
