// Sizes are stored as short codes ("M", "Free", "4-5Y") and translated only
// when shown, so a barcode label and the database never depend on language.

type T = (key: "common.freeSize" | "common.ageYears", values?: { range: string }) => string;

export function sizeLabel(size: string, t: T): string {
  if (size === "Free") return t("common.freeSize");
  const age = /^(\d+-\d+)Y$/.exec(size);
  if (age) return t("common.ageYears", { range: age[1] });
  return size;
}
