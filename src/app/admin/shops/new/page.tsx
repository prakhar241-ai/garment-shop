import { randomInt } from "node:crypto";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { nextShopCode } from "@/lib/admin/ops";
import { requireMaster } from "@/lib/session";
import { NewShopForm } from "../../AdminForms";

export default async function NewShopPage() {
  const { admin } = await requireMaster();
  const t = await getTranslations("admin");
  const code = await nextShopCode(admin);
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin" className="text-brand underline underline-offset-4">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("newShopTitle")}</h1>
      <NewShopForm suggestedCode={code} initialPin={pin} />
    </div>
  );
}
