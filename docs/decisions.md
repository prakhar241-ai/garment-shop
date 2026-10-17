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

**Libraries added and why**
- `next-intl` — Hindi/English text (required by the brief).
- `@supabase/supabase-js`, `@supabase/ssr` — database and login, with sessions kept in cookies for server rendering.
- `vitest` (dev) — unit tests and the Row Level Security tests.
- `jsbarcode` — draws the Code128 barcodes on labels.
