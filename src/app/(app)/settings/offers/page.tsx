import { getLocale, getTranslations } from "next-intl/server";
import { formatDate, formatPaise } from "@/lib/money";
import { localName } from "@/lib/names";
import { offerStatus, type Offer } from "@/lib/offers";
import { istToday } from "@/lib/period";
import { requireOwner } from "@/lib/session";
import { NewOfferForm, StopOffer } from "./OfferForms";

const day = (d: string) => formatDate(`${d}T12:00:00+05:30`);
const ORDER = { running: 0, upcoming: 1, stopped: 2, ended: 3 } as const;

export default async function OffersPage() {
  const { supabase } = await requireOwner();
  const t = await getTranslations();
  const locale = await getLocale();
  const today = istToday();

  const [{ data: offers }, { data: cats }] = await Promise.all([
    supabase.from("offers").select("id, name, kind, value, starts_on, ends_on, category_ids, active").is("deleted_at", null).order("starts_on", { ascending: false }),
    supabase.from("categories").select("id, name_hi, name_en").is("deleted_at", null).order("sort_order"),
  ]);
  const catName = new Map((cats ?? []).map((c) => [c.id, localName(c, locale)]));
  const list = ((offers ?? []) as Offer[]).toSorted((a, b) => ORDER[offerStatus(a, today)] - ORDER[offerStatus(b, today)]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t("offers.title")}</h1>
        <p className="text-muted">{t("offers.intro")}</p>
      </div>

      <NewOfferForm today={today} categories={(cats ?? []).map((c) => ({ id: c.id, name: catName.get(c.id)! }))} />

      {list.length === 0 && <p className="text-muted">{t("offers.none")}</p>}
      <ul className="flex flex-col gap-2">
        {list.map((o) => {
          const status = offerStatus(o, today);
          return (
            <li key={o.id} className={`rounded-xl border bg-surface p-3 ${status === "running" ? "border-brand border-2" : "border-border opacity-80"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-lg font-semibold">{o.name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 text-sm font-semibold ${
                    status === "running" ? "bg-brand text-brand-ink" : status === "upcoming" ? "bg-warn-bg text-warn-ink" : "bg-background text-muted"
                  }`}
                >
                  {t(`offers.status.${status}`)}
                </span>
              </div>
              <p className="font-semibold">
                {o.kind === "percent" ? t("offers.percentOff", { value: Number(o.value) }) : t("offers.flat", { price: formatPaise(Number(o.value)) })}
              </p>
              <p className="text-sm text-muted">
                {t("offers.dates", { from: day(o.starts_on), to: day(o.ends_on) })} ·{" "}
                {o.category_ids?.length ? o.category_ids.map((id) => catName.get(id) ?? "?").join(", ") : t("offers.onAll")}
              </p>
              {(status === "running" || status === "upcoming") && <StopOffer id={o.id} name={o.name} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
