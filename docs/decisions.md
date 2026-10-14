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

**Sizes** for the demo: S/M/L/XL for apparel and undergarments, "Free" for sarees and bedsheets, 2-3Y…8-9Y for kidswear. Each category has a `size_type` so the receiving grid (Phase 1) knows which sizes to show. To be confirmed with the owner before Phase 1.

**Migrations** are plain SQL files in `supabase/migrations`, applied in order by `npm run db:migrate` through the Supabase Management API (no Docker or Supabase CLI needed on the laptop). Applied files are tracked in `ops.migrations`.

**Libraries added and why**
- `next-intl` — Hindi/English text (required by the brief).
- `@supabase/supabase-js`, `@supabase/ssr` — database and login, with sessions kept in cookies for server rendering.
- `vitest` (dev) — unit tests and the Row Level Security tests.
