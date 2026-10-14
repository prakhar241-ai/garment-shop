"use client";

import { useActionState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { addStaff, setStaffActive, type StaffState } from "./actions";

export function AddStaffForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState<StaffState, FormData>(addStaff, undefined);

  const errorText =
    state?.error === "phoneTaken"
      ? t("staff.phoneTaken")
      : state?.error === "badPhone"
        ? t("login.badPhone")
        : state?.error === "badPin"
          ? t("login.badPin")
          : state?.error
            ? t("common.error")
            : null;

  const field = "min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-lg focus:border-brand focus:outline-none";

  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <h2 className="text-xl font-bold">{t("staff.add")}</h2>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("staff.name")}</span>
        <input name="name" required className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("staff.phone")}</span>
        <input name="phone" type="tel" inputMode="numeric" required className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{t("staff.pin")}</span>
        <input
          name="pin"
          inputMode="numeric"
          maxLength={6}
          pattern="\d{6}"
          required
          className={`${field} tracking-[0.4em]`}
        />
      </label>
      {errorText && (
        <p role="alert" className="font-semibold text-danger">
          {errorText}
        </p>
      )}
      {state?.ok && <p className="font-semibold text-brand">{t("staff.added")}</p>}
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-xl bg-brand text-lg font-bold text-brand-ink disabled:opacity-60"
      >
        {t("common.save")}
      </button>
    </form>
  );
}

export function ActiveToggle({ id, name, active }: { id: string; name: string; active: boolean }) {
  const t = useTranslations("staff");
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (active && !window.confirm(t("confirmDeactivate", { name }))) return;
        startTransition(() => setStaffActive(id, !active));
      }}
      className={`min-h-11 rounded-lg border-2 px-3 font-semibold disabled:opacity-60 ${
        active ? "border-danger text-danger" : "border-brand text-brand"
      }`}
    >
      {active ? t("deactivate") : t("activate")}
    </button>
  );
}
