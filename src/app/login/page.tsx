import { getTranslations } from "next-intl/server";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations();
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="flex items-center justify-between bg-brand px-4 py-3">
        <span className="text-lg font-bold text-brand-ink">{t("app.name")}</span>
        <LanguageToggle />
      </header>
      <main className="flex flex-1 flex-col justify-center gap-6 px-4 py-8">
        <div>
          <h1 className="text-3xl font-bold">{t("login.title")}</h1>
          <p className="mt-1 text-lg text-muted">{t("app.tagline")}</p>
        </div>
        <LoginForm initialError={error === "inactive" ? "inactive" : undefined} />
      </main>
    </div>
  );
}
