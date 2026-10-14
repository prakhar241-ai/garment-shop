-- Garment Shop Manager: initial schema (Phase 0)
--
-- Rules baked in here:
--   * Every business table has shop_id, created_at, updated_at, created_by.
--   * Row Level Security: a user only ever sees rows of their own shop.
--   * Money is integer paise (bigint), never floats.
--   * No hard deletes: DELETE is not granted to app users; rows carry deleted_at.
--   * Cost prices are hidden from staff at the database level: the base tables do
--     not grant SELECT on cost columns, and owners read them through owner-only views.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shops and users
-- ---------------------------------------------------------------------------

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,               -- short barcode prefix, e.g. S1
  owner_id uuid references auth.users(id),
  default_language text not null default 'hi' check (default_language in ('hi', 'en')),
  settings jsonb not null default '{"rounding": "49_99", "currency": "INR"}'::jsonb,
  barcode_seq integer not null default 0,  -- last used variant number for barcodes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  deleted_at timestamptz
);

-- "users" in the brief. Linked 1:1 to auth.users; login is phone + PIN.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id),
  name text not null,
  phone text not null,
  role text not null check (role in ('owner', 'staff')),
  language text not null default 'hi' check (language in ('hi', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (phone)
);

-- Helper functions used by every policy. SECURITY DEFINER so they can read
-- profiles without recursing into the profiles policy.
create or replace function public.current_shop_id() returns uuid
language sql stable security definer set search_path = public as $$
  select shop_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'owner' from public.profiles where id = auth.uid() and active),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  name_hi text not null,
  name_en text not null,
  size_type text not null default 'apparel' check (size_type in ('apparel', 'free', 'kids', 'custom')),
  default_markup_percent numeric(6,2) not null default 40,
  default_min_stock integer not null default 2,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  category_id uuid not null references public.categories(id),
  name text not null,                      -- as entered
  name_hi text,
  name_en text,
  notes text,                              -- brand / style notes
  photo_url text,
  color text,
  gst_rate numeric(5,2),                   -- unused in v1
  hsn text,                                -- unused in v1
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  product_id uuid not null references public.products(id),
  size text not null,
  color text,
  barcode text not null,
  cost_price bigint not null default 0 check (cost_price >= 0),        -- paise, OWNER ONLY
  selling_price bigint not null default 0 check (selling_price >= 0),  -- paise
  stock_qty integer not null default 0,    -- may go negative (warn, don't block)
  min_stock integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz,
  unique (shop_id, barcode)
);

-- ---------------------------------------------------------------------------
-- Suppliers and purchases
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  name text not null,
  phone text,
  notes text,
  balance bigint not null default 0,       -- paise we owe the supplier
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  supplier_id uuid not null references public.suppliers(id),
  bill_number text,
  bill_date date not null default current_date,
  total bigint not null default 0,         -- paise, OWNER ONLY (it is the cost)
  amount_paid bigint not null default 0,   -- paise, OWNER ONLY
  payment_mode text not null default 'bill' check (payment_mode in ('bill', 'cash', 'mixed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  purchase_id uuid not null references public.purchases(id),
  variant_id uuid not null references public.variants(id),
  qty integer not null check (qty > 0),
  cost_price bigint not null check (cost_price >= 0),  -- paise, OWNER ONLY
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Customers, sales, credit
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  name text not null,
  phone text,
  outstanding bigint not null default 0,   -- paise the customer owes us
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  sold_at timestamptz not null default now(),
  staff_id uuid default auth.uid() references auth.users(id),
  payment_mode text not null check (payment_mode in ('cash', 'udhaar', 'upi')),
  total bigint not null default 0,
  customer_id uuid references public.customers(id),
  discount_total bigint not null default 0,
  discount_approved_by uuid references auth.users(id),
  is_return boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  sale_id uuid not null references public.sales(id),
  variant_id uuid references public.variants(id),   -- null for an untagged quick sale
  qty integer not null,                              -- negative for a return
  selling_price_at_sale bigint not null,
  cost_price_at_sale bigint not null default 0,      -- OWNER ONLY, filled by trigger
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.credit_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  customer_id uuid not null references public.customers(id),
  entry_type text not null check (entry_type in ('credit_sale', 'payment')),
  amount bigint not null check (amount > 0),
  sale_id uuid references public.sales(id),
  entry_date timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Stock and price history, audit
-- ---------------------------------------------------------------------------

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  variant_id uuid not null references public.variants(id),
  qty_change integer not null,
  reason text not null check (reason in ('damage', 'theft', 'count_correction', 'return')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.price_changes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  variant_id uuid not null references public.variants(id),
  old_price bigint not null,
  new_price bigint not null,
  reason text not null check (reason in ('markdown', 'festival_offer', 'correction', 'initial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id),
  action text not null,
  table_name text,
  row_id uuid,
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id)
);

-- Indexes for the lookups the app does all day.
create index on public.profiles (shop_id);
create index on public.categories (shop_id);
create index on public.products (shop_id, category_id);
create index on public.variants (shop_id, product_id);
create index on public.suppliers (shop_id);
create index on public.purchases (shop_id, bill_date);
create index on public.purchase_items (purchase_id);
create index on public.customers (shop_id);
create index on public.sales (shop_id, sold_at);
create index on public.sale_items (sale_id);
create index on public.credit_entries (shop_id, customer_id);
create index on public.stock_adjustments (shop_id, variant_id);
create index on public.price_changes (shop_id, variant_id);
create index on public.audit_log (shop_id, created_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['shops','profiles','categories','products','variants','suppliers',
    'purchases','purchase_items','customers','sales','sale_items','credit_entries',
    'stock_adjustments','price_changes','audit_log']
  loop
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Staff never send a cost price on a sale line; the database copies it from the
-- variant so margin reports stay correct.
create or replace function public.fill_sale_item_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.variant_id is not null then
    select cost_price into new.cost_price_at_sale
      from public.variants where id = new.variant_id and shop_id = new.shop_id;
  end if;
  new.cost_price_at_sale := coalesce(new.cost_price_at_sale, 0);
  return new;
end $$;

create trigger fill_sale_item_cost before insert on public.sale_items
  for each row execute function public.fill_sale_item_cost();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.shops enable row level security;
alter table public.profiles enable row level security;

create policy shops_select on public.shops for select to authenticated
  using (id = public.current_shop_id());
create policy shops_update on public.shops for update to authenticated
  using (id = public.current_shop_id() and public.is_owner())
  with check (id = public.current_shop_id() and public.is_owner());

create policy profiles_select on public.profiles for select to authenticated
  using (shop_id = public.current_shop_id());
-- Users may change their own language; owners manage everyone in their shop.
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and shop_id = public.current_shop_id());
create policy profiles_update_owner on public.profiles for update to authenticated
  using (shop_id = public.current_shop_id() and public.is_owner())
  with check (shop_id = public.current_shop_id());

-- Standard shop-scoped tables: any member reads and inserts; only owners update.
do $$
declare t text;
begin
  foreach t in array array['categories','products','variants','suppliers','purchases',
    'purchase_items','customers','sales','sale_items','credit_entries',
    'stock_adjustments','price_changes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated
                    using (shop_id = public.current_shop_id())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (shop_id = public.current_shop_id())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (shop_id = public.current_shop_id() and public.is_owner())
                    with check (shop_id = public.current_shop_id())', t || '_update_owner', t);
  end loop;
end $$;

-- Staff record udhaar payments and edit customer details, so customers and
-- suppliers are updatable by any member of the shop.
create policy customers_update_member on public.customers for update to authenticated
  using (shop_id = public.current_shop_id()) with check (shop_id = public.current_shop_id());
create policy suppliers_update_member on public.suppliers for update to authenticated
  using (shop_id = public.current_shop_id()) with check (shop_id = public.current_shop_id());

alter table public.audit_log enable row level security;
create policy audit_log_select_owner on public.audit_log for select to authenticated
  using (shop_id = public.current_shop_id() and public.is_owner());
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (shop_id = public.current_shop_id());

-- ---------------------------------------------------------------------------
-- Privileges: no hard deletes, and cost columns hidden from everyone at the
-- table level. Owners read costs through the owner_* views below.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, update on public.shops to authenticated;
-- Only name and language are user-editable. Role, phone, shop and active are
-- changed by the owner through a server action (service role), so nobody can
-- promote themselves to owner.
grant select on public.profiles to authenticated;
grant update (name, language) on public.profiles to authenticated;
grant select, insert, update on
  public.categories, public.products, public.suppliers, public.customers,
  public.sales, public.credit_entries, public.stock_adjustments, public.price_changes
  to authenticated;
grant select, insert on public.audit_log to authenticated;

-- variants: everything except cost_price is readable.
grant select (id, shop_id, product_id, size, color, barcode, selling_price, stock_qty,
              min_stock, created_at, updated_at, created_by, deleted_at)
  on public.variants to authenticated;
grant insert, update on public.variants to authenticated;

-- purchases: staff may enter a bill and see that it exists, not what it cost.
grant select (id, shop_id, supplier_id, bill_number, bill_date, payment_mode, notes,
              created_at, updated_at, created_by, deleted_at)
  on public.purchases to authenticated;
grant insert, update on public.purchases to authenticated;

grant select (id, shop_id, purchase_id, variant_id, qty, created_at, updated_at,
              created_by, deleted_at)
  on public.purchase_items to authenticated;
grant insert, update on public.purchase_items to authenticated;

grant select (id, shop_id, sale_id, variant_id, qty, selling_price_at_sale, created_at,
              updated_at, created_by, deleted_at)
  on public.sale_items to authenticated;
grant insert (id, shop_id, sale_id, variant_id, qty, selling_price_at_sale)
  on public.sale_items to authenticated;
grant update (deleted_at) on public.sale_items to authenticated;

-- Owner-only views. They run as their owner (postgres) so they can read the
-- hidden columns, and filter to the caller's shop and to owners themselves.
create view public.owner_variant_costs as
  select id, shop_id, product_id, size, barcode, cost_price, selling_price, stock_qty
  from public.variants
  where shop_id = public.current_shop_id() and public.is_owner();

create view public.owner_purchases as
  select id, shop_id, supplier_id, bill_number, bill_date, total, amount_paid,
         payment_mode, notes, created_at, created_by, deleted_at
  from public.purchases
  where shop_id = public.current_shop_id() and public.is_owner();

create view public.owner_purchase_items as
  select id, shop_id, purchase_id, variant_id, qty, cost_price, created_at, deleted_at
  from public.purchase_items
  where shop_id = public.current_shop_id() and public.is_owner();

create view public.owner_sale_items as
  select id, shop_id, sale_id, variant_id, qty, selling_price_at_sale,
         cost_price_at_sale, created_at, deleted_at
  from public.sale_items
  where shop_id = public.current_shop_id() and public.is_owner();

grant select on public.owner_variant_costs, public.owner_purchases,
  public.owner_purchase_items, public.owner_sale_items to authenticated;

grant execute on function public.current_shop_id(), public.is_owner() to authenticated;
revoke execute on function public.current_shop_id(), public.is_owner() from anon;

-- Supabase grants new tables to anon/authenticated by default; stop that so a
-- future table is locked until someone writes its grants on purpose.
alter default privileges in schema public revoke all on tables from anon, authenticated;
