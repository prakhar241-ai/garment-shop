# Project brief: Garment Shop Manager (Hindi + English)

Paste this whole file into Claude Code as the first message, or save it as `CLAUDE.md` in an empty project folder and say: "Read CLAUDE.md and start with Phase 0."

## 1. What we are building

A phone-first web app (installable PWA, no app store) for small Indian garment shops. It replaces the paper notebook for stock, pricing, selling and credit (udhaar). First user is one real shop (cash business, about Rs 40,000 sales per day, many suppliers, sizes tracked per item). It must be built multi-shop from day one because it will be offered to other shops later.

Core promise: tag every item once when it arrives, scan it when it sells, and see stock, sales and reorder needs without writing anything down.

## 2. Users and roles

- **Owner**: full access, sets markup rules, approves discounts, sees all reports.
- **Staff**: can receive stock, tag items, sell, record udhaar payments. Cannot change prices, see cost prices, or delete records.
- Both may enter purchase bills and tag stock.
- Users are low on tech comfort. Hindi is the preferred language, staff understand a little English. Big buttons, few screens, minimal typing.

## 3. Language support (required, not optional)

- Two languages: Hindi (default) and English. Per-user language toggle, always visible in the header.
- No hardcoded UI text. Use an i18n library (for example `next-intl`) with `hi.json` and `en.json`. Every new string must be added to both files.
- Use Noto Sans Devanagari for Hindi. Test that nothing is clipped in Hindi, which is often longer than English.
- Format money as Indian rupees with Indian digit grouping (for example Rs 1,25,000). Dates as DD/MM/YYYY. Use Latin digits by default.
- Product names are stored once as entered. Optionally allow a second-language name per product (`name_hi`, `name_en`), and show whichever matches the user language, falling back to the other.
- Category names ship with both translations in seed data.

## 4. Recommended stack (change only with a good reason, and tell me why)

- Next.js (App Router) + TypeScript + Tailwind CSS, deployed on Vercel.
- Supabase (Postgres, Auth, Row Level Security) for data and login.
- Multi-tenant: every table has `shop_id`; Row Level Security enforces that users only see their own shop.
- Login by phone number and OTP or a simple PIN for staff (keep it easy; propose the best option before building).
- Barcode scanning from the phone camera (use the browser BarcodeDetector API with a `zxing-js` fallback). Must also work with a Bluetooth or USB scanner that types like a keyboard.
- Barcode format: Code128 encoding a short variant code (for example `S1-00042`).
- Label printing: generate print-ready pages (CSS print) for a thermal label printer (50mm x 25mm) and for A4 sticker sheets. Each label shows barcode, short product name, size, and price.
- Installable PWA, mobile-first layout (design for a 360px wide screen first), with an online-only first version. The shop has reliable internet. Plan the code so an offline queue can be added later.
- Money stored as integer paise, never floats.

## 5. Data model (start here, refine as needed)

All tables carry `shop_id`, `created_at`, `updated_at`, `created_by`.

- `shops`: name, owner, language default, settings (rounding rule, currency).
- `users`: role (owner or staff), language, linked to a shop.
- `categories`: name_hi, name_en, default_markup_percent, default_min_stock.
- `products`: category, name, name_hi, name_en, brand/style notes, photo (optional), color, gst_rate (nullable), hsn (nullable).
- `variants`: product, size, barcode (unique per shop), cost_price, selling_price, stock_qty, min_stock. One row per product + size (+ color if separate).
- `suppliers`: name, phone, notes, running balance.
- `purchases`: supplier, bill number, date, total, amount_paid, payment_mode (bill, cash, mixed), notes.
- `purchase_items`: purchase, variant, qty, cost_price.
- `sales`: date/time, staff, payment_mode (cash, udhaar, upi), total, customer (nullable), discount_total, discount_approved_by.
- `sale_items`: sale, variant, qty, selling_price_at_sale, cost_price_at_sale.
- `customers`: name, phone, outstanding balance.
- `credit_entries`: customer, type (sale on credit or payment received), amount, linked sale, date.
- `stock_adjustments`: variant, qty change, reason (damage, theft, count correction, return), user.
- `price_changes`: variant, old price, new price, user, reason (markdown, festival offer, correction).
- `audit_log` for sensitive actions.

Keep GST fields in the schema but unused in v1, because other shops will want GST billing later.

## 6. Features by phase

Build one phase at a time. At the end of each phase, stop, summarize what works, list what to test on a real phone, and wait for my go-ahead.

### Phase 0: Foundation
- Project setup, Supabase schema and Row Level Security, auth, roles.
- i18n in place with the Hindi/English toggle from the first screen.
- Seed data: a demo shop with garment categories (sarees, shirts, kidswear, undergarments, bedsheets) and about 30 sample products with sizes (S, M, L, XL for apparel; free size for sarees and bedsheets; kidswear by age).
- Basic layout: bottom navigation (Sell, Stock, Receive, Udhaar, Reports).

### Phase 1: Receive stock and labels (replaces manual price marking)
- Create a purchase: choose or add supplier, bill number, date.
- Add items fast: choose category, product, enter quantity per size in one grid (4 sizes across), enter cost price per item.
- App suggests selling price from the category markup rule, rounded to a clean price (for example ending in 49 or 99; make the rounding rule configurable). Owner can override per item.
- Record payment against the bill: paid by bill or cash, with amount paid and balance due to supplier.
- Generate one barcode label per variant per quantity received, or one label per variant with a copies count. Print to a thermal label printer or A4 sheet.
- Reprint labels any time.
- Staff cannot see cost prices (only owner).

### Phase 2: Selling (the daily screen)
- Scan a barcode with the camera or scanner. The item is added to the cart.
- Cart shows items, prices, total. One tap to choose Cash, UPI or Udhaar. Large, clear total.
- Prices are fixed. Staff cannot edit a price. An owner-approved discount (via owner PIN) is the only way to lower a price, and it is recorded.
- Quick sale fallback: choose category + size and type the price, for items with no tag.
- Stock reduces automatically. Warn (do not block) if stock goes negative so a missed receiving entry can be fixed.
- Returns and exchanges: scan the item, restore stock, record refund or credit.
- Optional: share a simple WhatsApp slip via a `wa.me` link (text only, no GST invoice in v1).

### Phase 3: Udhaar (credit)
- Customer list with name, phone, outstanding balance.
- Sell on credit links the sale to the customer. Record partial or full payments.
- Reminder button that opens WhatsApp with a ready Hindi/English message.
- Aging view: who owes the most and for how long.

### Phase 4: Daily close and reports
- Daily close screen: total sales by payment mode, expected cash vs counted cash, difference, udhaar given and collected, discounts given.
- Reports: sales by day, week, month; by category; by size; top and slow movers; margin by category (owner only).
- Stock report: current stock per variant, value of stock at cost (owner only).
- CSV export for everything.

### Phase 5: Reorder help
- Low stock list by size, using `min_stock` per variant.
- Fast movers and dead stock (no sale in N days, configurable).
- Suggested order per supplier based on recent sales speed and current stock. Keep it simple and explainable (for example, "sold 12 in last 30 days, 2 left, suggest 12").
- Export or share the order list to WhatsApp.

### Phase 6: Pricing discipline (supports the move to a fixed-price shop)
- Festival and clearance offers set in the app (percent or fixed price, date range, categories), shown on the sell screen so staff apply them openly.
- Price change history per item.
- Report: discounts given by staff and by day, so the owner can see if bargaining creeps back.

### Phase 7: Multi-shop readiness
- Shop signup and onboarding flow with a setup wizard (categories, markup rules, language).
- Simple subscription or invoice placeholder (no payment integration yet).
- GST invoicing module as an optional per-shop setting (later).

## 7. UX rules

- Mobile first. Every main action should take at most 3 taps. The Sell screen must support a sale in under 15 seconds.
- Large touch targets, high contrast, clear Hindi labels with icons.
- Confirmations for destructive actions. Soft delete, never hard delete business records.
- Show friendly error messages in the user's language.
- Fast: avoid long loading states on the Sell screen.

## 8. Safety, quality and process

- Row Level Security tested for cross-shop access. Write tests that prove shop A cannot read shop B.
- Unit tests for pricing, markup rounding, stock math, and credit balances. Money in paise.
- Never expose cost prices to the staff role, enforced on the server, not only hidden in the UI.
- Daily automatic database backups, and an owner-triggered CSV export.
- Keep a `docs/` folder with decisions and a short user guide in Hindi and English.
- Commit often with clear messages. Do not add libraries without saying why.
- Ask me before making big choices (login method, hosting, paid services). When something is ambiguous, ask one short question instead of guessing.

## 9. Assumptions to confirm with me before Phase 1

- The number of products (I said "9 SKU", which may mean 9 categories or a typo; design for up to a few thousand variants).
- Label printer model (I will buy a thermal label printer, tell me which specs to look for).
- Whether sarees, bedsheets and similar items need sizes or are free size.
- Whether prices should always round to a fixed ending.
- GST: not in v1, but schema is ready.

## 10. Definition of done for v1 (Phases 0 to 4)

- Owner and staff can log in, switch Hindi/English, receive a bill, print labels, scan and sell, record udhaar, and close the day.
- A real day of shop activity can be run without the notebook.
- Stock counts match a physical count within an agreed tolerance after the first week.
