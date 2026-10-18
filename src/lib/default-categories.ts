// Categories every new garment shop starts with. The owner can change the
// markup and minimum stock later in Settings.
export const DEFAULT_CATEGORIES = [
  { name_hi: "साड़ी", name_en: "Sarees", size_type: "free", markup: 40, min_stock: 1 },
  { name_hi: "शर्ट", name_en: "Shirts", size_type: "apparel", markup: 50, min_stock: 2 },
  { name_hi: "बच्चों के कपड़े", name_en: "Kidswear", size_type: "kids", markup: 45, min_stock: 2 },
  { name_hi: "अंडरगारमेंट्स", name_en: "Undergarments", size_type: "apparel", markup: 35, min_stock: 4 },
  { name_hi: "चादर", name_en: "Bedsheets", size_type: "free", markup: 40, min_stock: 2 },
] as const;
