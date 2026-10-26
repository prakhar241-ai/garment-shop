"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { changePrice, type PriceError } from "../actions";

const REASONS = ["correction", "markdown", "increase"] as const;
const field = "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";

/** Owner: change the selling price without a new bill, then reprint labels. */
export function PriceForm({ variantId, price, sizes }: { variantId: string; price: number; sizes: number }) {
  const t = useTranslations("price");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(price / 100));
  const [allSizes, setAllSizes] = useState(sizes > 1);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("correction");
  const [error, setError] = useState<PriceError | null>(null);
  const [changed, setChanged] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const paise = rupeesToPaise(value);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {changed && (
          <div className="rounded-xl bg-green-50 p-3">
            <p className="font-semibold text-brand">✓ {t("saved")}</p>
            <Link
              href={`/labels?v=${changed.map((id) => `${id}:1`).join(",")}`}
              className="mt-2 flex min-h-12 items-center justify-center rounded-xl border-2 border-brand font-bold text-brand"
            >
              {t("printNew")}
            </Link>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setChanged(null);
          }}
          className="min-h-14 rounded-xl border-2 border-brand text-lg font-bold text-brand"
        >
          {t("change")}
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-4">
      <h2 className="text-lg font-bold">{t("title")}</h2>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("newPrice")}</span>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">₹</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
            className={`${field} pl-8 text-2xl font-bold`}
          />
        </div>
        {paise !== null && paise !== price && (
          <span className="text-sm text-muted">
            {formatPaise(price)} → {formatPaise(paise)}
          </span>
        )}
      </label>
      {sizes > 1 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-semibold">{t("scope")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {[false, true].map((all) => (
              <button
                key={String(all)}
                type="button"
                aria-pressed={allSizes === all}
                onClick={() => setAllSizes(all)}
                className={`min-h-12 rounded-xl border-2 px-1 text-sm font-semibold ${allSizes === all ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
              >
                {all ? t("allSizes") : t("thisSize")}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-semibold">{t("reason")}</legend>
        <div className="grid grid-cols-3 gap-2">
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
          disabled={pending || !paise}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await changePrice({ variantId, allSizes, price: paise!, reason });
              if ("error" in res) setError(res.error);
              else {
                setOpen(false);
                setChanged(res.changed);
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
