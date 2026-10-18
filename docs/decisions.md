# Decisions

Short record of choices made and why. Newest at the bottom.

## 2026-10-14 — Phase 0

**Stack as recommended.** Next.js 16 (App Router) + TypeScript + Tailwind 4 on Vercel, Supabase for Postgres, Auth and Row Level Security. Supabase project in Mumbai (`ap-south-1`), free plan.

**Login: phone number + 6-digit PIN** (chosen by the shop owner over SMS OTP). No SMS cost and no DLT registration. Under the hood Supabase Auth stores it as email + password: the email is made from the phone (`p9876543210@phone-login.example.com`, a reserved domain that never receives mail) and the PIN is the password. Public sign-up is switched off: only the owner creates staff accounts, from Settings → Staff. SMS OTP can be added later without changing the data model.

**Language in a cookie, not the URL.** Language is per user, not per page, so there is no `/hi/...` routing. The choice is stored in a `lang` cookie and in `profiles.language` so it follows the user to a new phone. Hindi is the default. Library: `next-intl` (as the brief suggested).

**Cost prices hidden by the database, not the UI.** The `authenticated` role is not granted `SELECT` on any cost column (`variants.cost_price`, `purchases.total/amount_paid`, `purchase_items.cost_price`, `sale_items.cost_price_at_sale`). Owners read costs through views (`owner_variant_costs`, `owner_purchases`, `owner_purchase_items`, `owner_sale_items`) that return rows only when the caller is an owner. Consequence for code: always list columns explicitly — `select("*")` on those tables is refused for everyone.

**No hard deletes.** `DELETE` is not granted on any table. Records get `deleted_at` instead.

**Staff can't change prices or roles.** Only owners pass the `UPDATE` policy on catalogue and sales tables. On `profiles`, users may only update their own `name` and `language`; role, phone and active are changed by the owner through a server action.

**Money is integer paise** (`bigint`). Rounding of suggested prices always goes up, so the markup is never below what the owner set. Rules: `49_99` (default), `99`, `9`, `10`, `none`.

**Barcodes** are `<shop code>-<5 digits>`, e.g. `S1-00042`, unique per shop. `shops.barcode_seq` holds the last number used.

**Bilingual names (2026-10-17).** Shops and profiles also get optional `name_hi` / `name_en`, shown with the same fallback as products, so switching to English leaves no Hindi demo data in the header.

**Sizes** for the demo: S/M/L/XL for apparel and undergarments, "Free" for sarees and bedsheets, 2-3Y…8-9Y for kidswear. Each category has a `size_type` so the receiving grid (Phase 1) knows which sizes to show. To be confirmed with the owner before Phase 1.

**Migrations** are plain SQL files in `supabase/migrations`, applied in order by `npm run db:migrate` through the Supabase Management API (no Docker or Supabase CLI needed on the laptop). Applied files are tracked in `ops.migrations`.

## 2026-10-17 — Phase 1 (receive stock and labels)

**Owner's answers:** up to a few thousand variants; sarees and bedsheets are free size; prices round **up to the next ₹10**; no label printer yet, so build for 50×25 mm thermal plus A4 sheets.

**All stock-in goes through `receive_purchase()`** (a SECURITY DEFINER database function). It creates suppliers/products/variants as needed, assigns barcodes from `shops.barcode_seq`, adds stock, records the bill and the supplier balance in one transaction. Staff can enter cost prices but never read them back, and any selling price sent by staff is ignored: new sizes get the suggested price, existing sizes keep theirs. Owner price overrides are logged in `price_changes`.

**Rounding lives in two places on purpose.** `src/lib/pricing.ts` shows suggestions instantly in the form; `round_price()/suggest_price()` in SQL decide the real price so staff cannot bypass it. A test checks both give the same answer for every rule.

**Payment modes on a bill:** `bill` = nothing paid yet (all on the supplier's account), `cash` = paid in full, `mixed` = part paid. The owner can add later payments from the bill page (`pay_purchase()`). Supplier balances are owner-only (`owner_suppliers` view).

**Labels.** Code128 via `jsbarcode` (small, widely used, draws SVG). Three layouts: thermal 50×25 mm (one label per page), A4 65-up (38.1×21.2 mm) and A4 40-up (52.5×29.7 mm), with "skip used labels" for part-used sheets. Printed through the browser's print dialog with CSS `@page`. Verified by printing to PDF and decoding every barcode at 203 dpi.

## 2026-10-17 — Phase 2 (selling)

**All sales go through `make_sale()`.** The phone only sends what was scanned and how it was paid. Prices come from the database (a typed price is accepted only for an untagged quick-sale line). Stock goes down, or up for a returned item; below zero is allowed and reported back as a warning. Direct inserts into `sales`, `sale_items` and `credit_entries` are revoked.

**Returns and exchanges are just negative lines** in the same cart, priced at today's selling price (the shop is fixed-price). A negative total is money back: cash/UPI refund, or "credit to udhaar" which lowers what the customer owes.

**Discount = owner approval.** If the owner is logged in, they can give it. On a staff phone the owner types their PIN; the database checks it against the login hash (`check_owner_pin`, bcrypt via pgcrypto). Wrong PINs are logged; 5 in 10 minutes locks discounts for that shop. The approver is stored on the sale and every discount is in `audit_log`.

**Udhaar on the Sell screen** needs a customer: pick one or add name + phone. The full udhaar screens (list, payments, reminders) are Phase 3.

**Scanning.** Three ways in: the camera (browser `BarcodeDetector` on Android Chrome; `@zxing/browser` fallback on iPhone and laptops, loaded only when the camera opens), a USB/Bluetooth scanner (fast keystrokes + Enter anywhere on the page) and typing the code. The Sell page preloads every sellable size (paged past Supabase's 1000-row limit) so a scan is an instant lookup; codes not in the list are fetched from the server.

## 2026-10-18 — Phase 3 (udhaar)

**A balance only moves through the database functions:** `make_sale()` (udhaar sale or return credit), `record_payment()` (customer pays, cash or UPI, never more than is due) and `add_customer()` (optional opening balance from the old notebook, with the date it started). `customers.outstanding` cannot be written by the app directly; name and phone can.

**"Since when" uses first-in, first-out.** Payments clear the oldest udhaar first, so the age shown is the date of the oldest credit not yet covered (`customer_aging` view, security-invoker so Row Level Security still applies). Colours: under 30 days normal, 30–59 amber, 60+ red.

**Reminders** open WhatsApp with a ready message in Hindi or English (two buttons), independent of the app's current language. Built from the message files with `createTranslator`.

**Customer phones are stored as 10 digits** (database trigger), whatever was typed, so search and WhatsApp links are consistent.

## 2026-10-18 — Phase 4 (daily close and reports)

**Days are Indian calendar days** everywhere (`ist_day_start()` in SQL, `istToday()` in the app).

**Daily close.** `day_summary()` runs with the caller's rights (no cost prices), so staff can close the day. Expected cash = cash in the drawer in the morning + cash sales (net of cash refunds) + udhaar collected in cash − cash taken out (expenses, suppliers). The close stores the counted cash, the difference and what was left in the drawer, which pre-fills the next day's opening cash. Closing again on the same day updates that day's row.

**Reports are owner-only** and run in SECURITY DEFINER functions that return nothing to staff. A bill discount is spread over its lines in proportion to their value, so margins by category and size add up to the real takings. Slow movers = in stock, not sold in the chosen period, oldest last sale first.

**Charts** are single-series horizontal bars with the value printed on every bar, so the list is also the table view and nothing depends on colour.

**CSV export** (`/api/export/<kind>`) for every sale, day by day, categories, items, purchase bills, day closes, stock and udhaar. UTF-8 with BOM so Excel shows Hindi; headings in the user's language; cells that start like a formula are neutralised.

## 2026-10-18 — Master panel

**Master (platform admin) users** run the app for all shops at `/admin`: create shops with their owner and the standard categories, add owners and staff, reset PINs, switch logins on or off. They have no shop and see no shop's sales, costs or udhaar. `platform_admins` has no grants for app users; `is_platform_admin()` answers only for the caller. Master users are created only with `npm run admin:create -- <phone>` (prints a random PIN once). Every master page and server action calls `requireMaster()` before using the service-role client. The logic lives in `src/lib/admin/ops.ts` so it is tested directly. One phone number = one login, so the master number cannot be a shop login.

**Libraries added and why**
- `next-intl` — Hindi/English text (required by the brief).
- `@supabase/supabase-js`, `@supabase/ssr` — database and login, with sessions kept in cookies for server rendering.
- `vitest` (dev) — unit tests and the Row Level Security tests.
- `jsbarcode` — draws the Code128 barcodes on labels.
- `@zxing/browser`, `@zxing/library` — camera barcode reading where the browser has no built-in BarcodeDetector (iPhone, laptops).
