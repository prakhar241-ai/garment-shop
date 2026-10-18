"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { cancelBill, type CancelError } from "../actions";

/** Owner only: cancel a bill entered by mistake, with a reason. */
export function CancelBill({ purchaseId }: { purchaseId: string }) {
  const t = useTranslations("cancel");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<CancelError | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-12 rounded-xl border-2 border-danger font-semibold text-danger"
      >
        {t("button")}
      </button>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-danger bg-red-50 p-4">
      <h2 className="text-lg font-bold text-danger">{t("title")}</h2>
      <p>{t("explain")}</p>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("reason")}</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-danger focus:outline-none"
        />
      </label>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {t(`err.${error}`)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className="min-h-14 rounded-xl border-2 border-border bg-surface text-lg font-semibold">
          {t("keep")}
        </button>
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await cancelBill(purchaseId, reason);
              if ("error" in res) setError(res.error);
              else if (res.negative.length) {
                const list = res.negative.map((n) => `${n.barcode}: ${n.stock_qty}`).join("\n");
                window.alert(`${t("negative")}\n${list}`);
              }
            })
          }
          className="min-h-14 rounded-xl bg-danger text-lg font-bold text-white disabled:opacity-40"
        >
          {t("confirm")}
        </button>
      </div>
    </section>
  );
}
