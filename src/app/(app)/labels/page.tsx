import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session";
import { localName } from "@/lib/names";
import { sizeLabel } from "@/lib/sizes";
import { LabelSheet, type SheetRow } from "./LabelSheet";

type V = {
  id: string;
  barcode: string;
  size: string;
  selling_price: number;
  product: { name: string; name_hi: string | null; name_en: string | null };
};

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * /labels?purchase=<id>        labels for everything on a bill, one per piece
 * /labels?v=<id>:<copies>,...  reprint chosen sizes
 */
export default async function LabelsPage({ searchParams }: PageProps<"/labels">) {
  const { supabase } = await requireSession();
  const t = await getTranslations();
  const locale = await getLocale();
  const sp = await searchParams;

  const copies = new Map<string, number>();
  const purchase = typeof sp.purchase === "string" && UUID.test(sp.purchase) ? sp.purchase : null;
  if (purchase) {
    const { data } = await supabase
      .from("purchase_items")
      .select("variant_id, qty")
      .eq("purchase_id", purchase)
      .is("deleted_at", null)
      .order("created_at");
    for (const row of data ?? []) copies.set(row.variant_id, (copies.get(row.variant_id) ?? 0) + row.qty);
  } else if (typeof sp.v === "string") {
    for (const part of sp.v.split(",")) {
      const [id, n] = part.split(":");
      if (UUID.test(id)) copies.set(id, Math.min(Math.max(parseInt(n) || 1, 1), 500));
    }
  }

  let rows: SheetRow[] = [];
  if (copies.size) {
    const { data } = await supabase
      .from("variants")
      .select("id, barcode, size, selling_price, product:products(name, name_hi, name_en)")
      .in("id", [...copies.keys()])
      .returns<V[]>();
    const byId = new Map((data ?? []).map((v) => [v.id, v]));
    rows = [...copies.entries()]
      .filter(([id]) => byId.has(id))
      .map(([id, n]) => {
        const v = byId.get(id)!;
        return {
          id,
          copies: n,
          label: {
            barcode: v.barcode,
            name: localName(v.product, locale),
            size: sizeLabel(v.size, t),
            price: v.selling_price,
          },
        };
      });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 print:hidden">
        <Link href={purchase ? `/receive/${purchase}` : "/stock"} className="text-brand underline underline-offset-4">
          {t("receive.back")}
        </Link>
        <h1 className="text-2xl font-bold">{t("labels.title")}</h1>
        {purchase && <p className="font-semibold text-brand">✓ {t("receive.billSaved")}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted print:hidden">{t("labels.none")}</p>
      ) : (
        <LabelSheet rows={rows} />
      )}
    </div>
  );
}
