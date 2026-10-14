// Products are stored once as entered, with optional Hindi and English names.
// Show the one matching the user's language, falling back to the other, then
// to the name as entered.

type Named = { name?: string | null; name_hi?: string | null; name_en?: string | null };

export function localName(item: Named, locale: string): string {
  const preferred = locale === "en" ? item.name_en : item.name_hi;
  const other = locale === "en" ? item.name_hi : item.name_en;
  return preferred || other || item.name || "";
}
