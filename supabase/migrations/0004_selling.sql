-- Phase 2: selling, returns and exchanges.
--
-- All sales go through make_sale(), a SECURITY DEFINER function:
--   * prices come from the database, never from the phone (except a typed
--     price for an untagged "quick sale" item)
--   * stock goes down (or up, for a returned item); going below zero is
--     allowed and reported back as a warning
--   * a discount needs the owner: either the owner is logged in, or the
--     owner's PIN is typed on the staff phone. Wrong PINs are logged and
--     5 wrong tries in 10 minutes lock discounts for the shop for a while
--   * udhaar sales and credit refunds update the customer's balance

-- Untagged quick-sale lines have no variant, so keep what they were.
alter table public.sale_items
  add column category_id uuid references public.categories(id),
  add column size text,
  add column description text;
alter table public.sales add column subtotal bigint not null default 0;

-- Sales are only ever written by make_sale().
revoke insert, update on public.sales from authenticated;
revoke insert, update on public.sale_items from authenticated;
revoke insert, update on public.credit_entries from authenticated;
grant select (id, shop_id, sale_id, variant_id, qty, selling_price_at_sale, category_id, size, description,
              created_at, updated_at, created_by, deleted_at)
  on public.sale_items to authenticated;

create index on public.sale_items (shop_id, variant_id);

-- ---------------------------------------------------------------------------
-- Owner PIN check, used for discounts typed on a staff phone.
-- Returns the owner's user id, or null. Never raises, so a failed attempt
-- can be logged and kept.
-- ---------------------------------------------------------------------------
create or replace function public.check_owner_pin(p_shop uuid, p_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_owner uuid;
  v_fails int;
begin
  select count(*) into v_fails from public.audit_log
    where shop_id = p_shop and action = 'owner_pin_failed' and created_at > now() - interval '10 minutes';
  if v_fails >= 5 then return null; end if;

  select p.id into v_owner
    from public.profiles p join auth.users u on u.id = p.id
    where p.shop_id = p_shop and p.role = 'owner' and p.active
      and p_pin ~ '^\d{6}$'
      and u.encrypted_password = extensions.crypt(p_pin, u.encrypted_password)
    limit 1;

  if v_owner is null then
    insert into public.audit_log (shop_id, action, details) values (p_shop, 'owner_pin_failed', '{}'::jsonb);
  end if;
  return v_owner;
end $$;
revoke execute on function public.check_owner_pin(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- make_sale(payload)
--
-- payload = {
--   payment_mode: 'cash' | 'upi' | 'udhaar',
--   customer_id?: uuid,  new_customer?: { name, phone? },     (required for udhaar)
--   items: [
--     { variant_id: uuid, qty: int }                          tagged item; qty < 0 = returned
--     { category_id: uuid, size?: text, price: paise, qty: int, description?: text }   quick sale
--   ],
--   discount?: paise,  owner_pin?: text
-- }
-- returns { sale_id, subtotal, discount, total, stock: [{variant_id, stock_qty}],
--           negative: [{barcode, stock_qty}] }
--      or { error: 'bad_pin' | 'pin_locked' } (nothing saved)
--
-- A negative total is money going back to the customer: cash/upi = refund,
-- udhaar = taken off what the customer owes.
-- ---------------------------------------------------------------------------
create or replace function public.make_sale(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_user uuid := auth.uid();
  v_owner boolean := public.is_owner();
  v_mode text := payload->>'payment_mode';
  v_discount bigint := coalesce(nullif(payload->>'discount', '')::bigint, 0);
  v_approver uuid;
  v_customer uuid;
  v_sale uuid;
  v_item jsonb;
  v_qty int;
  v_price bigint;
  v_variant record;
  v_new_stock int;
  v_subtotal bigint := 0;
  v_total bigint;
  v_has_return boolean := false;
  v_stock jsonb := '[]'::jsonb;
  v_negative jsonb := '[]'::jsonb;
  v_category uuid;
  v_fails int;
begin
  if v_shop is null then raise exception 'not_logged_in'; end if;
  if v_mode is null or v_mode not in ('cash', 'upi', 'udhaar') then raise exception 'bad_payment_mode'; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') = 0 then
    raise exception 'empty_cart';
  end if;
  if v_discount < 0 then raise exception 'bad_discount'; end if;

  -- Discount approval comes first, before anything is written.
  if v_discount > 0 then
    if v_owner then
      v_approver := v_user;
    else
      select count(*) into v_fails from public.audit_log
        where shop_id = v_shop and action = 'owner_pin_failed' and created_at > now() - interval '10 minutes';
      if v_fails >= 5 then return jsonb_build_object('error', 'pin_locked'); end if;
      v_approver := public.check_owner_pin(v_shop, coalesce(payload->>'owner_pin', ''));
      if v_approver is null then return jsonb_build_object('error', 'bad_pin'); end if;
    end if;
  end if;

  -- Customer: required for udhaar, optional otherwise.
  if nullif(payload->>'customer_id', '') is not null then
    select id into v_customer from public.customers
      where id = (payload->>'customer_id')::uuid and shop_id = v_shop and deleted_at is null;
    if v_customer is null then raise exception 'customer_not_found'; end if;
  elsif coalesce(trim(payload->'new_customer'->>'name'), '') <> '' then
    insert into public.customers (shop_id, name, phone, created_by)
      values (v_shop, trim(payload->'new_customer'->>'name'),
              nullif(regexp_replace(coalesce(payload->'new_customer'->>'phone', ''), '\D', '', 'g'), ''), v_user)
      returning id into v_customer;
  end if;
  if v_mode = 'udhaar' and v_customer is null then raise exception 'customer_required'; end if;

  insert into public.sales (shop_id, payment_mode, customer_id, staff_id, created_by)
    values (v_shop, v_mode, v_customer, v_user, v_user)
    returning id into v_sale;

  for v_item in select value from jsonb_array_elements(payload->'items') loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty = 0 or abs(v_qty) > 1000 then raise exception 'bad_qty'; end if;
    if v_qty < 0 then v_has_return := true; end if;

    if nullif(v_item->>'variant_id', '') is not null then
      select v.id, v.selling_price, v.barcode, v.size into v_variant
        from public.variants v
        where v.id = (v_item->>'variant_id')::uuid and v.shop_id = v_shop and v.deleted_at is null
        for update;
      if v_variant.id is null then raise exception 'item_not_found'; end if;
      v_price := v_variant.selling_price;

      update public.variants set stock_qty = stock_qty - v_qty where id = v_variant.id
        returning stock_qty into v_new_stock;
      v_stock := v_stock || jsonb_build_object('variant_id', v_variant.id, 'stock_qty', v_new_stock);
      if v_new_stock < 0 then
        v_negative := v_negative || jsonb_build_object('barcode', v_variant.barcode, 'stock_qty', v_new_stock);
      end if;

      insert into public.sale_items (shop_id, sale_id, variant_id, qty, selling_price_at_sale, size, created_by)
        values (v_shop, v_sale, v_variant.id, v_qty, v_price, v_variant.size, v_user);
    else
      select id into v_category from public.categories
        where id = nullif(v_item->>'category_id', '')::uuid and shop_id = v_shop and deleted_at is null;
      if v_category is null then raise exception 'category_not_found'; end if;
      v_price := nullif(v_item->>'price', '')::bigint;
      if v_price is null or v_price <= 0 then raise exception 'bad_price'; end if;
      insert into public.sale_items (shop_id, sale_id, variant_id, category_id, size, description, qty,
                                     selling_price_at_sale, created_by)
        values (v_shop, v_sale, null, v_category, nullif(trim(coalesce(v_item->>'size', '')), ''),
                nullif(trim(coalesce(v_item->>'description', '')), ''), v_qty, v_price, v_user);
    end if;

    v_subtotal := v_subtotal + v_qty * v_price;
  end loop;

  if v_discount > 0 and v_discount > v_subtotal then raise exception 'bad_discount'; end if;
  v_total := v_subtotal - v_discount;

  update public.sales
    set subtotal = v_subtotal, total = v_total, discount_total = v_discount,
        discount_approved_by = v_approver, is_return = v_has_return
    where id = v_sale;

  if v_mode = 'udhaar' and v_total <> 0 then
    insert into public.credit_entries (shop_id, customer_id, entry_type, amount, sale_id, created_by)
      values (v_shop, v_customer, case when v_total > 0 then 'credit_sale' else 'payment' end,
              abs(v_total), v_sale, v_user);
    update public.customers set outstanding = outstanding + v_total where id = v_customer;
  end if;

  if v_discount > 0 then
    insert into public.audit_log (shop_id, action, table_name, row_id, details, created_by)
      values (v_shop, 'discount_given', 'sales', v_sale,
              jsonb_build_object('discount', v_discount, 'subtotal', v_subtotal, 'approved_by', v_approver), v_user);
  end if;
  if v_has_return then
    insert into public.audit_log (shop_id, action, table_name, row_id, details, created_by)
      values (v_shop, 'return', 'sales', v_sale, jsonb_build_object('total', v_total), v_user);
  end if;

  return jsonb_build_object('sale_id', v_sale, 'subtotal', v_subtotal, 'discount', v_discount,
                            'total', v_total, 'stock', v_stock, 'negative', v_negative);
end $$;

revoke execute on function public.make_sale(jsonb) from public, anon;
grant execute on function public.make_sale(jsonb) to authenticated;
