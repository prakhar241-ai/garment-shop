"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import { offerPrice } from "@/lib/offers";
import { createOffer, stopOffer, type OfferError } from "./actions";

const field = "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";

export function NewOfferForm({ today, categories }: { today: string; categories: { id: string; name: string }[] }) {
  const t = useTranslations("offers");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [cats, setCats] = useState<string[]>([]);
  const [error, setError] = useState<OfferError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const numeric = kind === "percent" ? Number(value) : rupeesToPaise(value);
  const example = numeric && numeric > 0 ? offerPrice(64900, kind, numeric) : null;

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        {saved && <p className="font-semibold text-brand">✓ {t("saved")}</p>}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSaved(false);
          }}
          className="min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink"
        >
          {t("new")}
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-4">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("name")}</span>
        <input value={name} placeholder={t("namePlaceholder")} onChange={(e) => setName(e.target.value)} className={field} />
      </label>
      <div className="flex flex-col gap-1">
        <span className="font-semibold">{t("kind")}</span>
        <div className="grid grid-cols-2 gap-2">
          {(["percent", "fixed"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setValue("");
              }}
              className={`min-h-12 rounded-xl border-2 px-1 text-sm font-semibold ${kind === k ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
            >
              {t(k)}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{kind === "percent" ? t("percentValue") : t("fixedValue")}</span>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted">{kind === "percent" ? "%" : "₹"}</span>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className={`${field} pl-8`} />
        </div>
        {example !== null && <span className="text-sm text-muted">{t("example", { price: formatPaise(example) })}</span>}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("from")}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{t("to")}</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={field} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-semibold">{t("categories")}</legend>
        <div className="flex flex-wrap gap-2">
          <Toggle on={cats.length === 0} label={t("all")} onClick={() => setCats([])} />
          {categories.map((c) => (
            <Toggle
              key={c.id}
              on={cats.includes(c.id)}
              label={c.name}
              onClick={() => setCats(cats.includes(c.id) ? cats.filter((x) => x !== c.id) : [...cats, c.id])}
            />
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
          disabled={pending || !name.trim() || !numeric}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await createOffer({ name, kind, value: numeric!, startsOn: from, endsOn: to, categoryIds: cats });
              if (res.error) setError(res.error);
              else {
                setOpen(false);
                setSaved(true);
                setName("");
                setValue("");
                setCats([]);
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

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-11 rounded-full border-2 px-3 text-sm font-semibold ${on ? "border-brand bg-brand text-brand-ink" : "border-border bg-surface"}`}
    >
      {label}
    </button>
  );
}

export function StopOffer({ id, name }: { id: string; name: string }) {
  const t = useTranslations("offers");
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t("confirmStop", { name }))) return;
        startTransition(async () => {
          await stopOffer(id);
        });
      }}
      className="mt-2 min-h-11 rounded-lg border-2 border-danger px-3 font-semibold text-danger disabled:opacity-40"
    >
      {t("stop")}
    </button>
  );
}
