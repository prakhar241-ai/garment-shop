"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { closeDay, type CloseError } from "./actions";

export type DaySummary = {
  bills: number;
  cash: number;
  upi: number;
  udhaar_sales: number;
  net_sales: number;
  discounts: number;
  discount_bills: number;
  offer_discounts?: number;
  returns: number;
  udhaar_given: number;
  udhaar_collected_cash: number;
  udhaar_collected_upi: number;
};

type Existing = { opening_cash: number; cash_out: number; counted_cash: number; left_in_drawer: number; notes: string | null } | null;

const field = "min-h-12 w-full rounded-xl border-2 border-border bg-surface pr-3 pl-8 text-xl focus:border-brand focus:outline-none";
const toRupees = (p: number) => (p ? String(p / 100) : "");

export function CloseForm({
  date,
  today,
  summary: s,
  existing,
  suggestedOpening,
}: {
  date: string;
  today: string;
  summary: DaySummary;
  existing: Existing;
  suggestedOpening: number;
}) {
  const t = useTranslations("close");
  const router = useRouter();
  const [opening, setOpening] = useState(toRupees(existing?.opening_cash ?? suggestedOpening));
  const [cashOut, setCashOut] = useState(toRupees(existing?.cash_out ?? 0));
  const [counted, setCounted] = useState(existing ? String(existing.counted_cash / 100) : "");
  const [left, setLeft] = useState(toRupees(existing?.left_in_drawer ?? existing?.opening_cash ?? suggestedOpening));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [error, setError] = useState<CloseError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const p = (v: string) => (v === "" ? 0 : rupeesToPaise(v));
  const openingP = p(opening);
  const outP = p(cashOut);
  const countedP = counted === "" ? null : rupeesToPaise(counted);
  const leftP = p(left);
  const expected = (openingP ?? 0) + s.cash + s.udhaar_collected_cash - (outP ?? 0);
  const diff = countedP === null ? null : countedP - expected;
  const valid = openingP !== null && outP !== null && countedP !== null && leftP !== null && leftP <= countedP;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-3">
        <span className="font-semibold">{t("date")}</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && router.push(`/reports/close?date=${e.target.value}`)}
          className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-lg"
        />
      </label>

      {existing && <p className="rounded-xl bg-warn-bg p-3 text-warn-ink">{t("alreadyClosed")}</p>}

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-lg font-bold">
          {t("today")} · {formatPaise(s.net_sales)}
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-base">
          <Row label={t("bills")} value={String(s.bills)} />
          <Row label={t("cashSales")} value={formatPaise(s.cash)} strong />
          <Row label={t("upiSales")} value={formatPaise(s.upi)} />
          <Row label={t("udhaarSales")} value={formatPaise(s.udhaar_sales)} />
          <Row label={t("collectedCash")} value={formatPaise(s.udhaar_collected_cash)} strong />
          <Row label={t("collectedUpi")} value={formatPaise(s.udhaar_collected_upi)} />
          <Row
            label={t("discounts")}
            value={s.discounts ? `${formatPaise(s.discounts)} (${t("discountBills", { count: s.discount_bills })})` : formatPaise(0)}
          />
          <Row label={t("offerDiscounts")} value={formatPaise(s.offer_discounts ?? 0)} />
          <Row label={t("returns")} value={formatPaise(s.returns)} />
        </dl>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-4">
        <h2 className="text-lg font-bold">{t("drawer")}</h2>
        <Money label={t("opening")} value={opening} onChange={setOpening} />
        <Money label={t("cashOut")} value={cashOut} onChange={setCashOut} />
        <div className="flex items-baseline justify-between rounded-xl bg-background p-3">
          <span>{t("expected")}</span>
          <span className="text-2xl font-bold">{formatPaise(expected)}</span>
        </div>
        <Money label={t("counted")} value={counted} onChange={setCounted} big />
        {diff !== null && (
          <p
            className={`rounded-xl p-3 text-center text-xl font-bold ${
              diff === 0 ? "bg-green-50 text-brand" : diff < 0 ? "bg-red-50 text-danger" : "bg-warn-bg text-warn-ink"
            }`}
          >
            {diff === 0 ? t("matched") : `${t("difference")}: ${formatPaise(Math.abs(diff))} ${diff < 0 ? t("short") : t("extra")}`}
          </p>
        )}
        <Money label={t("left")} value={left} onChange={setLeft} />
        <input
          placeholder={t("notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-lg"
        />
      </section>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-semibold text-danger">
          {t(`err.${error}`)}
        </p>
      )}
      {saved && <p className="text-center text-lg font-bold text-brand">✓ {t("saved")}</p>}

      <button
        type="button"
        disabled={pending || !valid}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            setSaved(false);
            const res = await closeDay({ date, opening: openingP!, cashOut: outP!, counted: countedP!, left: leftP!, notes });
            if (res.error) setError(res.error);
            else setSaved(true);
          })
        }
        className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40"
      >
        {existing ? t("update") : t("save")}
      </button>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? "font-semibold" : "text-muted"}>{label}</dt>
      <dd className={`text-right ${strong ? "font-bold" : ""}`}>{value}</dd>
    </>
  );
}

function Money({ label, value, onChange, big }: { label: string; value: string; onChange: (v: string) => void; big?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">₹</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          className={`${field} ${big ? "min-h-14 text-2xl font-bold" : ""}`}
        />
      </div>
    </label>
  );
}
