import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate, formatPaise } from "@/lib/money";
import { istToday } from "@/lib/period";
import { requireSession } from "@/lib/session";
import { CloseForm, type DaySummary } from "./CloseForm";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ClosePage({ searchParams }: PageProps<"/reports/close">) {
  const { supabase } = await requireSession();
  const t = await getTranslations("close");
  const sp = await searchParams;
  const today = istToday();
  const date = typeof sp.date === "string" && DATE.test(sp.date) && sp.date <= today ? sp.date : today;

  const [{ data: summary }, { data: existing }, { data: previous }, { data: recent }] = await Promise.all([
    supabase.rpc("day_summary", { p_date: date }),
    supabase
      .from("daily_closes")
      .select("opening_cash, cash_out, counted_cash, left_in_drawer, notes")
      .eq("close_date", date)
      .maybeSingle(),
    supabase.from("daily_closes").select("left_in_drawer").lt("close_date", date).order("close_date", { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from("daily_closes")
      .select("close_date, counted_cash, difference, summary")
      .order("close_date", { ascending: false })
      .limit(10),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/reports" className="text-brand underline underline-offset-4">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <CloseForm
        key={date}
        date={date}
        today={today}
        summary={summary as DaySummary}
        existing={existing}
        suggestedOpening={previous?.left_in_drawer ?? 0}
      />

      {(recent ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">{t("recent")}</h2>
          <ul className="flex flex-col gap-2">
            {(recent ?? []).map((r) => (
              <li key={r.close_date}>
                <Link
                  href={`/reports/close?date=${r.close_date}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3"
                >
                  <span>
                    <span className="block font-semibold">{formatDate(`${r.close_date}T12:00:00+05:30`)}</span>
                    <span className="text-sm text-muted">{formatPaise(r.summary.net_sales)}</span>
                  </span>
                  <span
                    className={`font-bold ${r.difference < 0 ? "text-danger" : r.difference > 0 ? "text-warn-ink" : "text-brand"}`}
                  >
                    {r.difference === 0 ? t("matched") : `${r.difference > 0 ? "+" : "−"}${formatPaise(Math.abs(r.difference))}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
