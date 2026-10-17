"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatPaise } from "@/lib/money";
import { ROUNDING_RULES, suggestSellingPrice, type RoundingRule } from "@/lib/pricing";
import { saveShopSettings } from "./actions";

type Cat = { id: string; name: string; markup: number; minStock: number };

export function ShopSettingsForm({ rounding, categories }: { rounding: RoundingRule; categories: Cat[] }) {
  const t = useTranslations();
  const [rule, setRule] = useState<RoundingRule>(rounding);
  const [cats, setCats] = useState(categories.map((c) => ({ ...c, markup: String(c.markup), minStock: String(c.minStock) })));
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setStatus(null);
    startTransition(async () => {
      const res = await saveShopSettings({
        rounding: rule,
        categories: cats.map((c) => ({ id: c.id, markup: Number(c.markup), minStock: parseInt(c.minStock) || 0 })),
      });
      setStatus(res.ok ? "saved" : "error");
    });
  }

  const cell = "min-h-12 w-full rounded-xl border-2 border-border bg-surface text-center text-lg focus:border-brand focus:outline-none";

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-lg font-bold">{t("settings.rounding")}</legend>
        {ROUNDING_RULES.map((r) => (
          <label
            key={r}
            className={`flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 ${rule === r ? "border-brand" : "border-border"}`}
          >
            <input type="radio" name="rounding" checked={rule === r} onChange={() => setRule(r)} className="h-5 w-5" />
            <span>{t(`settings.round_${r}`)}</span>
          </label>
        ))}
      </fieldset>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">{t("settings.markups")}</h2>
        <div className="grid grid-cols-[1fr_5rem_5rem] items-end gap-2 text-sm font-semibold text-muted">
          <span />
          <span className="text-center">{t("settings.markup")}</span>
          <span className="text-center">{t("settings.minStock")}</span>
        </div>
        {cats.map((c, i) => {
          const example = suggestSellingPrice(10000, Number(c.markup) || 0, rule);
          return (
            <div key={c.id} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="text-sm text-muted">{t("settings.example", { price: formatPaise(example) })}</p>
              </div>
              <input
                inputMode="decimal"
                value={c.markup}
                onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, markup: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                className={cell}
              />
              <input
                inputMode="numeric"
                value={c.minStock}
                onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, minStock: e.target.value.replace(/\D/g, "") } : x)))}
                className={cell}
              />
            </div>
          );
        })}
      </section>

      {status === "saved" && <p className="font-semibold text-brand">✓ {t("settings.saved")}</p>}
      {status === "error" && <p className="font-semibold text-danger">{t("common.error")}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {t("common.save")}
      </button>
    </div>
  );
}
