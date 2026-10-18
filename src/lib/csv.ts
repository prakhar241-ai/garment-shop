// CSV files that open correctly in Excel and Google Sheets, Hindi included.

export type Cell = string | number | boolean | null | undefined;

function escape(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  const s = String(cell);
  // Stop spreadsheet formula injection from typed names like "=HYPERLINK(...)".
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 BOM so Excel reads Devanagari, CRLF line ends, RFC 4180 quoting. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n") + "\r\n";
}

/** Paise as a plain rupee number for spreadsheets: 12345 -> "123.45". */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
