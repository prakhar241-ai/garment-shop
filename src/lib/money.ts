// All money in the app is integer paise. These helpers are the only place that
// converts between paise and what a person types or reads.

export type Paise = number;

/** Rupees as typed by a person ("450", "450.50") -> paise. Returns null if invalid. */
export function rupeesToPaise(input: string | number): Paise | null {
  const text = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const wholeFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const paiseFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12500000 -> "₹1,25,000"; 45050 -> "₹450.50". Latin digits always. */
export function formatPaise(paise: Paise): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const fmt = abs % 100 === 0 ? wholeFormat : paiseFormat;
  return `${sign}₹${fmt.format(abs / 100)}`;
}

/** Date -> DD/MM/YYYY in India time. */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
}
