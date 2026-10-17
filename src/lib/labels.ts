// Label sheet layouts. Sizes in millimetres.

export type LabelFormat = "thermal" | "a4_65" | "a4_40";

export type Layout = {
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
  marginTop: number;
  marginLeft: number;
  colGap: number;
  rowGap: number;
  /** Scale of text and barcode relative to the 50×25 thermal label. */
  scale: number;
};

export const LAYOUTS: Record<LabelFormat, Layout> = {
  // One 50×25 mm label per "page": thermal printers feed label by label.
  thermal: { pageW: 50, pageH: 25, cols: 1, rows: 1, labelW: 50, labelH: 25, marginTop: 0, marginLeft: 0, colGap: 0, rowGap: 0, scale: 1 },
  // Standard 65-up sheet (38.1×21.2 mm, e.g. Avery L7651 and local equivalents).
  a4_65: { pageW: 210, pageH: 297, cols: 5, rows: 13, labelW: 38.1, labelH: 21.2, marginTop: 10.7, marginLeft: 4.65, colGap: 2.5, rowGap: 0, scale: 0.8 },
  // 40-up sheet that fills A4 exactly (52.5×29.7 mm).
  a4_40: { pageW: 210, pageH: 297, cols: 4, rows: 10, labelW: 52.5, labelH: 29.7, marginTop: 0, marginLeft: 0, colGap: 0, rowGap: 0, scale: 1.05 },
};

export type LabelItem = {
  barcode: string;
  name: string;
  size: string;
  price: number; // paise
};

/** Repeat each item `copies` times, in order. Negative or fractional copies count as 0. */
export function expandCopies<T>(items: { item: T; copies: number }[]): T[] {
  return items.flatMap(({ item, copies }) => Array<T>(Math.max(0, Math.floor(copies))).fill(item));
}

/** Split labels into pages. `skip` leaves that many empty slots at the start
 *  of the first sheet, so a half-used sticker sheet can be reused. */
export function paginate<T>(labels: T[], format: LabelFormat, skip = 0): (T | null)[][] {
  const perPage = LAYOUTS[format].cols * LAYOUTS[format].rows;
  const leading = format === "thermal" ? 0 : Math.min(Math.max(0, Math.floor(skip)), perPage - 1);
  const slots: (T | null)[] = [...Array<null>(leading).fill(null), ...labels];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < slots.length; i += perPage) pages.push(slots.slice(i, i + perPage));
  return labels.length ? pages : [];
}
