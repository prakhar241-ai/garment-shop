import { formatDate, formatPaise, type Paise } from "./money";

// Plain-text sale slip for WhatsApp (no GST invoice in v1).

export type SlipLabels = {
  total: string;
  discount: string;
  returned: string;
  mode: string;
  thanks: string;
};

export type SlipLine = { name: string; size: string; qty: number; price: Paise };

export function slipText(opts: {
  shop: string;
  date: Date;
  lines: SlipLine[];
  discount: Paise;
  total: Paise;
  modeLabel: string;
  labels: SlipLabels;
}): string {
  const { shop, date, lines, discount, total, modeLabel, labels } = opts;
  const out = [`*${shop}*`, formatDate(date), ""];
  for (const l of lines) {
    const tag = l.qty < 0 ? ` (${labels.returned})` : "";
    out.push(`${l.name} ${l.size} × ${Math.abs(l.qty)}${tag} = ${formatPaise(l.price * l.qty)}`);
  }
  out.push("");
  if (discount > 0) out.push(`${labels.discount}: -${formatPaise(discount)}`);
  out.push(`*${labels.total}: ${formatPaise(total)}*`);
  out.push(`${labels.mode}: ${modeLabel}`);
  out.push("", labels.thanks);
  return out.join("\n");
}

/** wa.me link; with a 10-digit Indian number it opens that chat directly. */
export function whatsappLink(text: string, phone?: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits.length === 12 && digits.startsWith("91") ? digits : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
