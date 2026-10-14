"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLanguage } from "@/app/actions/language";

/** One button that switches to the other language. Always in the header. */
export function LanguageToggle() {
  const t = useTranslations("lang");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const next = locale === "hi" ? "en" : "hi";

  return (
    <button
      type="button"
      aria-label={t("label")}
      disabled={pending}
      onClick={() => startTransition(() => setLanguage(next))}
      className="min-h-11 rounded-full border-2 border-white/70 px-4 text-base font-semibold text-white disabled:opacity-60"
    >
      {t("toggle")}
    </button>
  );
}
