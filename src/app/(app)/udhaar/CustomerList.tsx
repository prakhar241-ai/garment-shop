"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ageBucket, daysSince } from "@/lib/aging";
import { formatPaise } from "@/lib/money";

export type Row = {
  id: string;
  name: string;
  phone: string | null;
  outstanding: number;
  oldest_unpaid: string | null;
  last_payment: string | null;
};

type Sort = "amount" | "age" | "name";
const SORT_KEY = "udhaarSort";

export function CustomerList({ rows }: { rows: Row[] }) {
  const t = useTranslations("udhaar");
  const [sort, setSort] = useState<Sort>("amount");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);

  // Remember the chosen sort on this phone (a convenience only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount
      if (saved === "amount" || saved === "age" || saved === "name") setSort(saved);
    } catch {}
  }, []);
  const choose = (s: Sort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {}
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    const list = rows.filter(
      (r) =>
        (all || term || r.outstanding > 0) &&
        (!term || r.name.toLowerCase().includes(term) || (digits.length >= 3 && r.phone?.includes(digits))),
    );
    return list.toSorted((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "age") {
        const ta = a.oldest_unpaid ? Date.parse(a.oldest_unpaid) : Infinity;
        const tb = b.oldest_unpaid ? Date.parse(b.oldest_unpaid) : Infinity;
        return ta - tb || b.outstanding - a.outstanding;
      }
      return b.outstanding - a.outstanding;
    });
  }, [rows, q, all, sort]);

  return (
    <div className="flex flex-col gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("search")}
        aria-label={t("search")}
        className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none"
      />
      <div className="grid grid-cols-3 gap-2" role="group">
        {(
          [
            ["amount", t("sortAmount")],
            ["age", t("sortAge")],
            ["name", t("sortName")],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={sort === value}
            onClick={() => choose(value)}
            className={`min-h-11 rounded-xl border-2 px-1 text-sm font-semibold ${
              sort === value ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex min-h-11 items-center gap-3 text-base">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-5 w-5" />
        {t("showAll")}
      </label>

      {shown.length === 0 && <p className="text-muted">{rows.some((r) => r.outstanding > 0) || q ? t("none") : t("nothingDue")}</p>}

      <ul className="flex flex-col gap-2">
        {shown.map((r) => {
          const days = r.oldest_unpaid ? daysSince(r.oldest_unpaid) : null;
          const bucket = days === null ? null : ageBucket(days);
          return (
            <li key={r.id}>
              <Link href={`/udhaar/${r.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{r.name}</p>
                  <p className="text-sm text-muted">{r.phone ?? "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-xl font-bold ${r.outstanding > 0 ? "" : "text-muted"}`}>
                    {r.outstanding > 0 ? formatPaise(r.outstanding) : t("settled")}
                  </p>
                  {days !== null && (
                    <span
                      className={`inline-block rounded-full px-2 text-sm font-semibold ${
                        bucket === "old" ? "bg-red-100 text-danger" : bucket === "late" ? "bg-warn-bg text-warn-ink" : "bg-background text-muted"
                      }`}
                    >
                      {days === 0 ? t("today") : t("days", { count: days })}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
