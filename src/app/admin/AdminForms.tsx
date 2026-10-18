"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { AdminError } from "@/lib/admin/ops";
import { ROUNDING_RULES, type RoundingRule } from "@/lib/pricing";
import { addUserAction, createShopAction, resetMyPinAction, resetPinAction, setActiveAction, suggestPin } from "./actions";

const field = "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";
const primary = "min-h-14 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-40";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

function ErrorText({ error }: { error: AdminError | null }) {
  const t = useTranslations("admin");
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-50 p-3 font-semibold text-danger">
      {t(`err.${error}`)}
    </p>
  );
}

function PinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("admin");
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <input
        inputMode="numeric"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className={`${field} font-mono tracking-[0.4em]`}
      />
      <button
        type="button"
        onClick={async () => onChange(await suggestPin())}
        className="min-h-12 rounded-xl border-2 border-brand px-3 font-semibold text-brand"
      >
        {t("generate")}
      </button>
    </div>
  );
}

export function NewShopForm({ suggestedCode, initialPin }: { suggestedCode: string; initialPin: string }) {
  const t = useTranslations();
  const [nameHi, setNameHi] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [code, setCode] = useState(suggestedCode);
  const [language, setLanguage] = useState<"hi" | "en">("hi");
  const [rounding, setRounding] = useState<RoundingRule>("10");
  const [seed, setSeed] = useState(true);
  const [owner, setOwner] = useState({ name: "", phone: "", pin: initialPin });
  const [error, setError] = useState<AdminError | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("admin.shopNameHi")}>
        <input value={nameHi} onChange={(e) => setNameHi(e.target.value)} className={field} />
      </Field>
      <Field label={t("admin.shopNameEn")}>
        <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={field} />
      </Field>
      <Field label={t("admin.shopCode")} hint={t("admin.shopCodeHint", { code: code || suggestedCode })}>
        <input
          value={code}
          maxLength={5}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          className={`${field} font-mono`}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("admin.language")}>
          <select value={language} onChange={(e) => setLanguage(e.target.value as "hi" | "en")} className={field}>
            <option value="hi">हिंदी</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label={t("admin.rounding")}>
          <select value={rounding} onChange={(e) => setRounding(e.target.value as RoundingRule)} className={field}>
            {ROUNDING_RULES.map((r) => (
              <option key={r} value={r}>
                {t(`settings.round_${r}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} className="mt-1 h-5 w-5" />
        <span>{t("admin.seed")}</span>
      </label>

      <fieldset className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-4">
        <legend className="px-1 text-lg font-bold">{t("admin.ownerSection")}</legend>
        <Field label={t("admin.name")}>
          <input value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} className={field} />
        </Field>
        <Field label={t("admin.phone")}>
          <input
            type="tel"
            inputMode="numeric"
            value={owner.phone}
            onChange={(e) => setOwner({ ...owner, phone: e.target.value })}
            className={field}
          />
        </Field>
        <Field label={t("admin.pin")} hint={t("admin.pinHint")}>
          <PinInput value={owner.pin} onChange={(pin) => setOwner({ ...owner, pin })} />
        </Field>
      </fieldset>

      <ErrorText error={error} />
      <button
        type="button"
        disabled={pending || (!nameHi.trim() && !nameEn.trim()) || !owner.name.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await createShopAction({ nameHi, nameEn, code, language, rounding, seedCategories: seed, owner });
            if (res?.error) setError(res.error);
          })
        }
        className={primary}
      >
        {pending ? t("admin.creating") : t("admin.create")}
      </button>
    </div>
  );
}

export function AddUserForm({ shopId }: { shopId: string }) {
  const t = useTranslations("admin");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", pin: "", role: "staff" as "owner" | "staff" });
  const [error, setError] = useState<AdminError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {done && <p className="rounded-xl bg-green-50 p-3 font-semibold text-brand">✓ {done}</p>}
        <button
          type="button"
          onClick={async () => {
            setOpen(true);
            setDone(null);
            setForm({ name: "", phone: "", pin: await suggestPin(), role: "staff" });
          }}
          className="min-h-14 rounded-xl border-2 border-dashed border-brand text-lg font-bold text-brand"
        >
          + {t("addPerson")}
        </button>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-brand bg-surface p-4">
      <h2 className="text-lg font-bold">{t("addPerson")}</h2>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("role")}>
        {(["staff", "owner"] as const).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={form.role === r}
            onClick={() => setForm({ ...form, role: r })}
            className={`min-h-12 rounded-xl border-2 font-bold ${form.role === r ? "border-brand bg-brand text-brand-ink" : "border-border"}`}
          >
            {r === "owner" ? t("roleOwner") : t("roleStaff")}
          </button>
        ))}
      </div>
      <Field label={t("name")}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
      </Field>
      <Field label={t("phone")}>
        <input
          type="tel"
          inputMode="numeric"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className={field}
        />
      </Field>
      <Field label={t("pin")} hint={t("pinHint")}>
        <PinInput value={form.pin} onChange={(pin) => setForm({ ...form, pin })} />
      </Field>
      <ErrorText error={error} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className="min-h-14 rounded-xl border-2 border-border text-lg font-semibold">
          ✕
        </button>
        <button
          type="button"
          disabled={pending || !form.name.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await addUserAction(shopId, form);
              if (res.error) setError(res.error);
              else {
                setOpen(false);
                setDone(`${t("added")} ${form.phone} · PIN ${form.pin}`);
              }
            })
          }
          className={primary}
        >
          {t("add")}
        </button>
      </div>
    </section>
  );
}

export function UserActions({ userId, name, active, shopId }: { userId: string; name: string; active: boolean; shopId: string }) {
  const t = useTranslations("admin");
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<AdminError | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={async () => {
            setPinOpen(!pinOpen);
            setMsg(null);
            setPin(await suggestPin());
          }}
          className="min-h-11 rounded-lg border-2 border-brand font-semibold text-brand"
        >
          {t("resetPin")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (active && !window.confirm(t("confirmOff", { name }))) return;
            startTransition(async () => {
              const res = await setActiveAction(userId, !active, shopId);
              if (res.error) setError(res.error);
            });
          }}
          className={`min-h-11 rounded-lg border-2 font-semibold disabled:opacity-40 ${
            active ? "border-danger text-danger" : "border-brand text-brand"
          }`}
        >
          {active ? t("switchOff") : t("switchOn")}
        </button>
      </div>
      {pinOpen && (
        <div className="flex flex-col gap-2">
          <PinInput value={pin} onChange={setPin} />
          <button
            type="button"
            disabled={pending || pin.length !== 6}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await resetPinAction(userId, pin, shopId);
                if (res.error) setError(res.error);
                else {
                  setMsg(t("pinChanged", { pin }));
                  setPinOpen(false);
                }
              })
            }
            className="min-h-12 rounded-xl bg-brand font-bold text-brand-ink disabled:opacity-40"
          >
            {t("newPin")} ✓
          </button>
        </div>
      )}
      {msg && <p className="font-semibold text-brand">✓ {msg}</p>}
      <ErrorText error={error} />
    </div>
  );
}

export function MyPinForm() {
  const t = useTranslations("admin");
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<AdminError | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <button type="button" onClick={() => setOpen(!open)} className="min-h-11 self-start font-semibold text-brand underline">
        {t("myPin")}
      </button>
      {saved && <p className="font-semibold text-brand">✓ {t("myPinSaved")}</p>}
      {open && (
        <>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            aria-label={t("newPin")}
            className={`${field} tracking-[0.5em]`}
          />
          <ErrorText error={error} />
          <button
            type="button"
            disabled={pending || pin.length !== 6}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await resetMyPinAction(pin);
                if (res.error) setError(res.error);
                else {
                  setSaved(true);
                  setOpen(false);
                  setPin("");
                }
              })
            }
            className={primary}
          >
            {t("newPin")} ✓
          </button>
        </>
      )}
    </section>
  );
}
