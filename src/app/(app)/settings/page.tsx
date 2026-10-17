import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/lib/session";

export default async function SettingsPage() {
  await requireOwner();
  const t = await getTranslations("settings");
  const links = [
    { href: "/settings/shop", label: t("shop") },
    { href: "/settings/staff", label: t("staff") },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="flex min-h-14 items-center justify-between rounded-xl border border-border bg-surface px-4 text-lg font-semibold"
        >
          {l.label}
          <span aria-hidden="true">›</span>
        </Link>
      ))}
    </div>
  );
}
