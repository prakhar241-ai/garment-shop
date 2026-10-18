import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageToggle } from "@/components/LanguageToggle";
import { requireMaster } from "@/lib/session";
import { logout } from "../login/actions";

/** Master panel: only master users get past requireMaster(). No shop, no tabs. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireMaster();
  const t = await getTranslations();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 bg-[#1f2a44] px-4 py-2 text-white">
        <div className="flex items-center justify-between gap-2">
          <Link href="/admin" className="min-w-0">
            <p className="truncate text-lg font-bold">{t("admin.title")}</p>
            <p className="truncate text-sm opacity-90">{t("admin.subtitle")}</p>
          </Link>
          <LanguageToggle />
        </div>
        <form action={logout} className="mt-1 text-sm">
          <button type="submit" className="underline underline-offset-4">
            {t("header.logout")}
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 pt-4 pb-10">{children}</main>
    </div>
  );
}
