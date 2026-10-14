import { getTranslations } from "next-intl/server";

/** Placeholder for a tab whose phase has not been built yet. */
export async function ComingSoon({ section, phase }: { section: string; phase: number }) {
  const t = await getTranslations();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t(`${section}.title`)}</h1>
      <div className="rounded-2xl border-2 border-dashed border-border bg-surface p-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t("common.phase", { n: phase })}
        </p>
        <p className="mt-2 text-lg">{t(`${section}.intro`)}</p>
      </div>
    </div>
  );
}
