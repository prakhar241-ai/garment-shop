"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { login, type LoginState } from "./actions";

export function LoginForm({ initialError }: { initialError?: "inactive" }) {
  const t = useTranslations("login");
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    initialError ? { error: initialError } : undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-lg font-semibold">{t("phone")}</span>
        <input
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder={t("phonePlaceholder")}
          required
          className="min-h-14 rounded-xl border-2 border-border bg-surface px-4 text-xl tracking-wider focus:border-brand focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-lg font-semibold">{t("pin")}</span>
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={6}
          pattern="\d{6}"
          required
          className="min-h-14 rounded-xl border-2 border-border bg-surface px-4 text-2xl tracking-[0.5em] focus:border-brand focus:outline-none"
        />
      </label>

      {state?.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-base font-semibold text-danger">
          {t(state.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-14 rounded-xl bg-brand text-xl font-bold text-brand-ink disabled:opacity-60"
      >
        {t("submit")}
      </button>
    </form>
  );
}
