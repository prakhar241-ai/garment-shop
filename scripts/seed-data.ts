// Demo shop data. Prices are in rupees here for readability; the seed script
// converts to paise. Kept separate from the script so it is easy to edit.

export const SIZES = {
  apparel: ["S", "M", "L", "XL"],
  free: ["Free"],
  kids: ["2-3Y", "4-5Y", "6-7Y", "8-9Y"],
} as const;

export type SizeType = keyof typeof SIZES;

export type SeedCategory = {
  key: string;
  name_hi: string;
  name_en: string;
  size_type: SizeType;
  markup: number;
  min_stock: number;
  products: { name_en: string; name_hi: string; color?: string; cost: number }[];
};

export const DEMO_CATEGORIES: SeedCategory[] = [
  {
    key: "sarees",
    name_hi: "साड़ी",
    name_en: "Sarees",
    size_type: "free",
    markup: 40,
    min_stock: 1,
    products: [
      { name_en: "Cotton Saree", name_hi: "कॉटन साड़ी", color: "Red", cost: 450 },
      { name_en: "Silk Saree", name_hi: "सिल्क साड़ी", color: "Maroon", cost: 1800 },
      { name_en: "Georgette Saree", name_hi: "जॉर्जेट साड़ी", color: "Pink", cost: 650 },
      { name_en: "Banarasi Saree", name_hi: "बनारसी साड़ी", color: "Gold", cost: 2500 },
      { name_en: "Printed Daily Wear Saree", name_hi: "प्रिंटेड रोज़ाना साड़ी", color: "Blue", cost: 280 },
      { name_en: "Chiffon Saree", name_hi: "शिफॉन साड़ी", color: "Green", cost: 520 },
    ],
  },
  {
    key: "shirts",
    name_hi: "शर्ट",
    name_en: "Shirts",
    size_type: "apparel",
    markup: 50,
    min_stock: 2,
    products: [
      { name_en: "Formal White Shirt", name_hi: "फॉर्मल सफ़ेद शर्ट", color: "White", cost: 300 },
      { name_en: "Check Shirt", name_hi: "चेक शर्ट", color: "Blue", cost: 280 },
      { name_en: "Linen Shirt", name_hi: "लिनन शर्ट", color: "Beige", cost: 550 },
      { name_en: "Denim Shirt", name_hi: "डेनिम शर्ट", color: "Blue", cost: 420 },
      { name_en: "Printed Casual Shirt", name_hi: "प्रिंटेड कैज़ुअल शर्ट", color: "Black", cost: 260 },
      { name_en: "Half Sleeve Shirt", name_hi: "हाफ़ बाजू शर्ट", color: "Grey", cost: 220 },
    ],
  },
  {
    key: "kidswear",
    name_hi: "बच्चों के कपड़े",
    name_en: "Kidswear",
    size_type: "kids",
    markup: 45,
    min_stock: 2,
    products: [
      { name_en: "Kids T-Shirt", name_hi: "बच्चों की टी-शर्ट", color: "Yellow", cost: 120 },
      { name_en: "Frock", name_hi: "फ्रॉक", color: "Pink", cost: 250 },
      { name_en: "Kids Kurta Pyjama", name_hi: "बच्चों का कुर्ता पजामा", color: "White", cost: 350 },
      { name_en: "Kids Jeans", name_hi: "बच्चों की जींस", color: "Blue", cost: 280 },
      { name_en: "Baba Suit", name_hi: "बाबा सूट", color: "Green", cost: 200 },
      { name_en: "Kids Shorts", name_hi: "बच्चों के शॉर्ट्स", color: "Navy", cost: 110 },
    ],
  },
  {
    key: "undergarments",
    name_hi: "अंडरगारमेंट्स",
    name_en: "Undergarments",
    size_type: "apparel",
    markup: 35,
    min_stock: 4,
    products: [
      { name_en: "Men's Vest", name_hi: "पुरुषों की बनियान", color: "White", cost: 70 },
      { name_en: "Men's Brief", name_hi: "पुरुषों की ब्रीफ़", color: "Assorted", cost: 60 },
      { name_en: "Women's Brief", name_hi: "महिलाओं की ब्रीफ़", color: "Assorted", cost: 55 },
      { name_en: "Camisole", name_hi: "कैमिसोल", color: "Skin", cost: 90 },
      { name_en: "Boxer Shorts", name_hi: "बॉक्सर शॉर्ट्स", color: "Check", cost: 110 },
      { name_en: "Thermal Top", name_hi: "थर्मल टॉप", color: "Grey", cost: 220 },
    ],
  },
  {
    key: "bedsheets",
    name_hi: "चादर",
    name_en: "Bedsheets",
    size_type: "free",
    markup: 40,
    min_stock: 2,
    products: [
      { name_en: "Single Bedsheet", name_hi: "सिंगल चादर", color: "Floral", cost: 250 },
      { name_en: "Double Bedsheet", name_hi: "डबल चादर", color: "Floral", cost: 450 },
      { name_en: "King Size Bedsheet Set", name_hi: "किंग साइज़ चादर सेट", color: "Maroon", cost: 900 },
      { name_en: "Jaipuri Bedsheet", name_hi: "जयपुरी चादर", color: "Blue", cost: 600 },
      { name_en: "Pillow Cover Pair", name_hi: "तकिया कवर जोड़ी", color: "White", cost: 120 },
      { name_en: "Dohar", name_hi: "दोहर", color: "Green", cost: 700 },
    ],
  },
];

/** Deterministic pseudo-random stock (0-8) so the demo shows some low stock. */
export function demoStock(i: number): number {
  return (i * 7 + 3) % 9;
}
