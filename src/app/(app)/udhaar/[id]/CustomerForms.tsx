"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { recordPayment, updateCustomer, type UdhaarError } from "../actions";

const field = "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";

/** "Money received": full amount is one tap, part payment is a typed amount. */
export function PaymentForm({ customerId, due }: { customerId: string; due: number }) {
  const t = useTranslations("udhaar");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(due / 100));
  const [mode, setMode] = useState<"cash" | "upi">("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<UdhaarError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const paise = rupeesToPaise(amount);

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {saved && <p className="font-semibold text-brand">✓ {t("saved")}</p>}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSaved(false);
            setAmount(String(due / 100));
          }}
          className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink"
        >
          {t("receive")}
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-4">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("amount")}</span>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">₹</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className={`${field} pl-8 text-2xl font-bold`}
          />
        </div>
        {paise !== due && (
          <button type="button" onClick={() => setAmount(String(due / 100))} className="self-start font-semibold text-brand underline">
            {t("full", { amount: formatPaise(due) })}
          </button>
        )}
      </label>
      <div className="flex flex-col gap-1">
        <span className="font-semibold">{t("mode")}</span>
        <div className="grid grid-cols-2 gap-2">
          {(["cash", "upi"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-12 rounded-xl border-2 text-lg font-bold ${mode === m ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
            >
              {t(m)}
            </button>
          ))}
        </div>
      </div>
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
          disabled={pending || !paise || paise > due}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await recordPayment(customerId, paise!, mode, notes);
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

export function EditCustomer({ customerId, name, phone }: { customerId: string; name: string; phone: string }) {
  const t = useTranslations("udhaar");
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(name);
  const [p, setP] = useState(phone);
  const [error, setError] = useState<UdhaarError | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 self-start font-semibold text-brand underline">
        {t("edit")}
      </button>
    );
  }
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3">
      <input aria-label={t("name")} value={n} onChange={(e) => setN(e.target.value)} className={field} />
      <input aria-label={t("phone")} type="tel" inputMode="numeric" value={p} onChange={(e) => setP(e.target.value)} className={field} />
      {error && <p className="font-semibold text-danger">{t(`err.${error}`)}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await updateCustomer(customerId, n, p);
            if (res.error) setError(res.error);
            else setOpen(false);
          })
        }
        className="min-h-12 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {t("save")}
      </button>
    </section>
  );
}
