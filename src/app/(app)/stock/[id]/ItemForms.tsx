"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { adjustStock, setMinStock, type AdjustError } from "../actions";

const REASONS = ["count_correction", "damage", "theft", "return"] as const;
const field = "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";

/** Owner: set the counted quantity, or add/remove pieces, with a reason. */
export function AdjustForm({ variantId, stock }: { variantId: string; stock: number }) {
  const t = useTranslations("item");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"set" | "change">("set");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("count_correction");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<AdjustError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const n = /^-?\d+$/.test(value.trim()) ? parseInt(value, 10) : null;
  const after = n === null ? null : mode === "set" ? n : stock + n;
  const valid = n !== null && after !== null && after !== stock && (mode === "change" || n >= 0);

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        {saved && <p className="font-semibold text-brand">✓ {t("saved")}</p>}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSaved(false);
            setValue("");
          }}
          className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink"
        >
          {t("adjust")}
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-4">
      <h2 className="text-lg font-bold">{t("adjustTitle")}</h2>
      <div className="grid grid-cols-2 gap-2" role="group">
        {(["set", "change"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setValue("");
            }}
            className={`min-h-12 rounded-xl border-2 px-1 font-semibold ${mode === m ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
          >
            {m === "set" ? t("modeSet") : t("modeChange")}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{mode === "set" ? t("counted") : t("change")}</span>
        <input
          inputMode={mode === "set" ? "numeric" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(mode === "set" ? /\D/g : /[^\d-]/g, ""))}
          placeholder={mode === "set" ? String(Math.max(stock, 0)) : "-1"}
          className={`${field} text-2xl font-bold`}
        />
      </label>
      {valid && <p className="rounded-xl bg-background p-3 text-lg font-semibold">{t("willBe", { from: stock, to: after! })}</p>}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-semibold">{t("reason")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={`min-h-12 rounded-xl border-2 px-1 text-sm font-semibold ${reason === r ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
            >
              {t(`reasons.${r}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <input placeholder={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {t(`err.${error}`)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className="min-h-14 rounded-xl border-2 border-border text-lg font-semibold">
          ✕
        </button>
        <button
          type="button"
          disabled={pending || !valid}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await adjustStock({ variantId, mode, value: n!, reason, notes });
              if ("error" in res) setError(res.error);
              else {
                setOpen(false);
                setSaved(true);
                setNotes("");
              }
            })
          }
          className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
        >
          {t("save")}
        </button>
      </div>
    </section>
  );
}

export function MinStockForm({ variantId, min }: { variantId: string; min: number }) {
  const t = useTranslations("item");
  const [value, setValue] = useState(String(min));
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const n = /^\d+$/.test(value) ? parseInt(value, 10) : null;

  return (
    <section className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-3">
      <span className="font-semibold">{t("minTitle")}</span>
      <span className="text-sm text-muted">{t("minHint")}</span>
      <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, ""));
            setSaved(false);
          }}
          aria-label={t("minTitle")}
          className={`${field} text-center`}
        />
        <button
          type="button"
          disabled={pending || n === null || n === min}
          onClick={() =>
            startTransition(async () => {
              const res = await setMinStock(variantId, n!);
              setSaved(res.ok);
            })
          }
          className="min-h-12 rounded-xl border-2 border-brand px-4 font-bold text-brand disabled:opacity-40"
        >
          {t("save")}
        </button>
      </div>
      {saved && <p className="text-sm font-semibold text-brand">✓ {t("minSaved")}</p>}
    </section>
  );
}
