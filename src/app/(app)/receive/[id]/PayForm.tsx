"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { rupeesToPaise } from "@/lib/money";
import { payBill, type ReceiveError } from "../actions";

/** Owner records a payment against a bill that still has money due. */
export function PayForm({ purchaseId, due }: { purchaseId: string; due: number }) {
  const t = useTranslations("receive");
  const [amount, setAmount] = useState(String(due / 100));
  const [error, setError] = useState<ReceiveError | null>(null);
  const [pending, startTransition] = useTransition();
  const paise = rupeesToPaise(amount);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("amountPaid")}</span>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">₹</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="min-h-12 w-full rounded-xl border-2 border-border bg-surface pr-3 pl-8 text-lg focus:border-brand focus:outline-none"
          />
        </div>
      </label>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {t(`err.${error}`)}
        </p>
      )}
      <button
        type="button"
        disabled={pending || !paise || paise > due}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await payBill(purchaseId, paise!);
            if (res?.error) setError(res.error);
          })
        }
        className="min-h-12 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {t("addPayment")}
      </button>
    </div>
  );
}
