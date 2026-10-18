import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { NewCustomerForm } from "./NewCustomerForm";

export default async function NewCustomerPage() {
  await requireSession();
  const t = await getTranslations("udhaar");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <div className="flex flex-col gap-4">
      <Link href="/udhaar" className="text-brand underline underline-offset-4">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("newTitle")}</h1>
      <NewCustomerForm today={today} />
    </div>
  );
}
