// How long a customer has owed money, in whole days (India time).

const DAY = 86_400_000;
const IST = 5.5 * 60 * 60 * 1000;

/** Whole days between `since` and `now`, counting calendar days in India. */
export function daysSince(since: Date | string, now: Date = new Date()): number {
  const s = typeof since === "string" ? new Date(since) : since;
  const day = (d: Date) => Math.floor((d.getTime() + IST) / DAY);
  return Math.max(0, day(now) - day(s));
}

export type AgeBucket = "fresh" | "late" | "old";

/** Under 30 days is normal, 30–59 needs a reminder, 60+ is overdue. */
export function ageBucket(days: number): AgeBucket {
  if (days >= 60) return "old";
  if (days >= 30) return "late";
  return "fresh";
}
