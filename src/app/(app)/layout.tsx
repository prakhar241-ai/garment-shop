import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BottomNav } from "@/components/BottomNav";
import { LanguageToggle } from "@/components/LanguageToggle";
import { localName } from "@/lib/names";
import { requireSession } from "@/lib/session";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, shop } = await requireSession();
  const t = await getTranslations("header");
  const locale = await getLocale();

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-10 bg-brand px-4 py-2 text-brand-ink">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{localName(shop, locale)}</p>
            <p className="truncate text-sm opacity-90">
              {localName(profile, locale)} · {t(profile.role)}
            </p>
          </div>
          <LanguageToggle />
        </div>
        <div className="mt-1 flex gap-4 text-sm">
          {profile.role === "owner" && (
            <Link href="/settings/staff" className="underline underline-offset-4">
              {t("settings")}
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="underline underline-offset-4">
              {t("logout")}
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-4 pt-4 pb-24">{children}</main>
      <BottomNav />
    </div>
  );
}
