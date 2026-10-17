import { getLocale, getTranslations } from "next-intl/server";
import { localName } from "@/lib/names";
import { requireOwner } from "@/lib/session";
import { ActiveToggle, AddStaffForm } from "./StaffForms";

export default async function StaffPage() {
  const { supabase } = await requireOwner();
  const t = await getTranslations();
  const locale = await getLocale();

  const { data: people } = await supabase
    .from("profiles")
    .select("id, name, name_hi, name_en, phone, role, active")
    .order("role")
    .order("name");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("staff.title")}</h1>
      <ul className="flex flex-col gap-2">
        {(people ?? []).map((p) => (
          <li
            key={p.id}
            className={`flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3 ${
              p.active ? "" : "opacity-60"
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{localName(p, locale)}</p>
              <p className="text-sm text-muted">
                {p.phone} · {t(`header.${p.role}`)}
                {!p.active && ` · ${t("staff.inactive")}`}
              </p>
            </div>
            {p.role === "staff" && <ActiveToggle id={p.id} name={localName(p, locale)} active={p.active} />}
          </li>
        ))}
      </ul>
      <AddStaffForm />
    </div>
  );
}
