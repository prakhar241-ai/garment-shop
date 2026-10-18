// Report periods, as Indian calendar dates (YYYY-MM-DD).

export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";
export type Period = { from: string; to: string; grain: "day" | "week" | "month" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Bars per day up to ~5 weeks, per week up to ~6 months, then per month. */
export function grainFor(from: string, to: string): Period["grain"] {
  const n = daysBetween(from, to);
  return n <= 35 ? "day" : n <= 190 ? "week" : "month";
}

export function resolvePeriod(key: string | undefined, from?: string, to?: string, now: Date = new Date()): Period & { key: PeriodKey } {
  const today = istToday(now);
  const make = (k: PeriodKey, f: string, t: string) => ({ key: k, from: f, to: t, grain: grainFor(f, t) });
  switch (key) {
    case "today":
      return make("today", today, today);
    case "yesterday":
      return make("yesterday", shift(today, -1), shift(today, -1));
    case "30d":
      return make("30d", shift(today, -29), today);
    case "month":
      return make("month", `${today.slice(0, 8)}01`, today);
    case "lastMonth": {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = shift(firstThis, -1);
      return make("lastMonth", `${lastPrev.slice(0, 8)}01`, lastPrev);
    }
    case "custom":
      if (from && to && DATE.test(from) && DATE.test(to) && from <= to && to <= today && daysBetween(from, to) <= 731) {
        return make("custom", from, to);
      }
      return make("7d", shift(today, -6), today);
    default:
      return make("7d", shift(today, -6), today);
  }
}

/** Every bucket start between from and to, so days with no sales still show. */
export function buckets(from: string, to: string, grain: Period["grain"]): string[] {
  const out: string[] = [];
  if (grain === "month") {
    let d = `${from.slice(0, 8)}01`;
    while (d <= to) {
      out.push(d);
      const [y, m] = d.split("-").map(Number);
      d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }
    return out;
  }
  if (grain === "week") {
    // ISO weeks start on Monday, like Postgres date_trunc('week').
    const start = new Date(`${from}T00:00:00Z`);
    const back = (start.getUTCDay() + 6) % 7;
    let d = shift(from, -back);
    while (d <= to) {
      out.push(d);
      d = shift(d, 7);
    }
    return out;
  }
  for (let d = from; d <= to; d = shift(d, 1)) out.push(d);
  return out;
}
