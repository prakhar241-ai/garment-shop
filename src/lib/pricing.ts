import type { Paise } from "./money";

// How a suggested selling price is rounded. Stored per shop in shops.settings.rounding.
//   49_99 : next price ending in 49 or 99 rupees  (450 -> 499, 420 -> 449)
//   99    : next price ending in 99 rupees        (450 -> 499, 510 -> 599)
//   9     : next price ending in 9 rupees         (450 -> 459)
//   10    : next multiple of 10 rupees            (453 -> 460)
//   none  : next whole rupee
export type RoundingRule = "49_99" | "99" | "9" | "10" | "none";

export const ROUNDING_RULES: RoundingRule[] = ["49_99", "99", "9", "10", "none"];

/** Round a price (paise) UP to the shop's clean-price rule. Never rounds down,
 *  so the markup is always at least what the owner set. */
export function roundPrice(paise: Paise, rule: RoundingRule): Paise {
  if (paise <= 0) return 0;
  const rupees = Math.ceil(paise / 100);
  let result: number;
  switch (rule) {
    case "none":
      result = rupees;
      break;
    case "10":
      result = Math.ceil(rupees / 10) * 10;
      break;
    case "9":
      result = nextEnding(rupees, 10, [9]);
      break;
    case "99":
      result = nextEnding(rupees, 100, [99]);
      break;
    case "49_99":
      result = nextEnding(rupees, 100, [49, 99]);
      break;
  }
  return result * 100;
}

/** Smallest value >= rupees whose remainder mod `step` is one of `endings`. */
function nextEnding(rupees: number, step: number, endings: number[]): number {
  const base = Math.floor(rupees / step) * step;
  for (const e of endings) {
    if (base + e >= rupees) return base + e;
  }
  return base + step + endings[0];
}

/** Cost + markup percent, then rounded. markupPercent may have decimals (e.g. 37.5). */
export function suggestSellingPrice(cost: Paise, markupPercent: number, rule: RoundingRule): Paise {
  if (cost <= 0) return 0;
  // Basis points keep the multiplication in integers.
  const bp = Math.round(markupPercent * 100);
  const raw = Math.ceil((cost * (10000 + bp)) / 10000);
  return roundPrice(raw, rule);
}

/** Margin percent on selling price, one decimal. Owner-only reports. */
export function marginPercent(cost: Paise, selling: Paise): number {
  if (selling <= 0) return 0;
  return Math.round(((selling - cost) / selling) * 1000) / 10;
}
