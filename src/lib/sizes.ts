// Sizes are stored as short codes ("M", "Free", "4-5Y") and translated only
// when shown, so a barcode label and the database never depend on language.

/** The sizes the receiving grid offers, by category size_type. */
export const SIZES = {
  apparel: ["S", "M", "L", "XL"],
  free: ["Free"],
  kids: ["2-3Y", "4-5Y", "6-7Y", "8-9Y"],
} as const;

export type SizeType = keyof typeof SIZES;

export function sizesFor(sizeType: string): readonly string[] {
  return SIZES[sizeType as SizeType] ?? SIZES.apparel;
}

type T = (key: "common.freeSize" | "common.ageYears", values?: { range: string }) => string;

export function sizeLabel(size: string, t: T): string {
  if (size === "Free") return t("common.freeSize");
  const age = /^(\d+-\d+)Y$/.exec(size);
  if (age) return t("common.ageYears", { range: age[1] });
  return size;
}
