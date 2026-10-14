"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const ITEMS = [
  { href: "/sell", key: "sell", icon: "M3 6h18l-2 12H5L3 6Zm5 0V4a4 4 0 0 1 8 0v2" },
  { href: "/stock", key: "stock", icon: "M3 7l9-4 9 4-9 4-9-4Zm0 5l9 4 9-4M3 17l9 4 9-4" },
  { href: "/receive", key: "receive", icon: "M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" },
  { href: "/udhaar", key: "udhaar", icon: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" },
  { href: "/reports", key: "reports", icon: "M4 20V10m6 10V4m6 16v-7m4 7H2" },
] as const;

/** Five big tabs, icon + label, fixed to the bottom of the screen. */
export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-sm leading-tight ${
                  active ? "font-bold text-brand" : "text-muted"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-7 w-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.4 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={item.icon} />
                </svg>
                <span className="text-center">{t(item.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
