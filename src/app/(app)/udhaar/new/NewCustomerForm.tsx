"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { rupeesToPaise } from "@/lib/money";
import { addCustomer, type UdhaarError } from "../actions";

const field = "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";

export function NewCustomerForm({ today }: { today: string }) {
  const t = useTranslations("udhaar");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [opening, setOpening] = useState("");
  const [since, setSince] = useState(today);
  const [error, setError] = useState<UdhaarError | null>(null);
  const [pending, startTransition] = useTransition();
  const openingPaise = opening ? rupeesToPaise(opening) : null;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("phone")}</span>
        <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
      </label>

      <fieldset className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3">
        <legend className="px-1 font-semibold">{t("opening")}</legend>
        <p className="text-sm text-muted">{t("openingHint")}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">₹</span>
            <input
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))}
              aria-label={t("opening")}
              className={`${field} pl-8`}
            />
          </div>
          <label className="flex flex-col">
            <span className="sr-only">{t("since")}</span>
            <input type="date" max={today} value={since} onChange={(e) => setSince(e.target.value)} aria-label={t("since")} className={field} />
          </label>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-semibold text-danger">
          {t(`err.${error}`)}
        </p>
      )}

      <button
        type="button"
        disabled={pending || !name.trim() || (opening !== "" && openingPaise === null)}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await addCustomer({
              name,
              phone,
              opening: openingPaise,
              since: openingPaise ? since : null,
            });
            if (res?.error) setError(res.error);
          })
        }
        className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {t("save")}
      </button>
    </div>
  );
}
