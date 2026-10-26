-- Phase 6: pricing discipline.
--   * Owner can change a selling price any time (one size or all sizes of an
--     item), with a reason; every change is in price_changes.
--   * Festival / clearance offers: percent off or a fixed price, a date range,
--     all or some categories. make_sale() applies the best running offer to
--     each tagged line, so the price can't be skipped or faked on the phone.
--     Each line keeps its regular price and the offer used.
--   * Discount report by staff and by day (bill discounts and offer discounts).

-- A price can also go up.
alter table public.price_changes drop constraint price_changes_reason_check;
alter table public.price_changes add constraint price_changes_reason_check
  check (reason in ('markdown', 'festival_offer', 'correction', 'initial', 'increase'));

-- ---------------------------------------------------------------------------
-- Owner changes a price without a new bill.
-- ---------------------------------------------------------------------------
create or replace function public.set_price(p_variant uuid, p_all_sizes boolean, p_price bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_product uuid;
  v_row record;
  v_changed jsonb := '[]'::jsonb;
begin
  if not public.is_owner() then raise exception 'owner_only'; end if;
  if p_price is null or p_price <= 0 then raise exception 'bad_price'; end if;
  if p_reason not in ('correction', 'markdown', 'increase') then raise exception 'bad_reason'; end if;

  select product_id into v_product from public.variants where id = p_variant and shop_id = v_shop and deleted_at is null;
  if v_product is null then raise exception 'item_not_found'; end if;

  for v_row in
    select id, selling_price from public.variants
    where shop_id = v_shop and deleted_at is null
      and (id = p_variant or (p_all_sizes and product_id = v_product))
    for update
  loop
    if v_row.selling_price <> p_price then
      update public.variants set selling_price = p_price where id = v_row.id;
      insert into public.price_changes (shop_id, variant_id, old_price, new_price, reason, created_by)
        values (v_shop, v_row.id, v_row.selling_price, p_price, p_reason, auth.uid());
      v_changed := v_changed || to_jsonb(v_row.id);
    end if;
  end loop;

  if jsonb_array_length(v_changed) = 0 then raise exception 'no_change'; end if;
  insert into public.audit_log (shop_id, action, table_name, row_id, details)
    values (v_shop, 'price_changed', 'variants', p_variant,
            jsonb_build_object('price', p_price, 'reason', p_reason, 'sizes', jsonb_array_length(v_changed)));
  return jsonb_build_object('changed', v_changed);
end $$;
revoke execute on function public.set_price(uuid, boolean, bigint, text) from public, anon;
grant execute on function public.set_price(uuid, boolean, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  name text not null,
  kind text not null check (kind in ('percent', 'fixed')),
  value numeric not null check (value > 0),  -- percent (e.g. 10) or a fixed price in paise
  starts_on date not null,
  ends_on date not null,
  category_ids uuid[],                       -- null or empty = all categories
  active boolean not null default true,      -- owner can stop an offer early
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz,
  check (ends_on >= starts_on),
  check (kind <> 'percent' or value < 100)
);
create trigger touch_updated_at before update on public.offers for each row execute function public.touch_updated_at();
create index on public.offers (shop_id, starts_on, ends_on);
alter table public.offers enable row level security;
create policy offers_select on public.offers for select to authenticated using (shop_id = public.current_shop_id());
create policy offers_insert_owner on public.offers for insert to authenticated
  with check (shop_id = public.current_shop_id() and public.is_owner());
create policy offers_update_owner on public.offers for update to authenticated
  using (shop_id = public.current_shop_id() and public.is_owner()) with check (shop_id = public.current_shop_id());
grant select, insert, update on public.offers to authenticated;

-- Offer price, mirrored in src/lib/offers.ts (tests check both agree).
-- Percent: rounded DOWN to the whole rupee (the customer never gets less than
-- the advertised discount). Fixed: that price, only if it is lower.
create or replace function public.offer_price(p_price bigint, p_kind text, p_value numeric) returns bigint
language sql immutable as $$
  select case
    when p_kind = 'percent' then least(p_price, (floor(p_price * (100 - p_value) / 10000) * 100)::bigint)
    when p_kind = 'fixed' then least(p_price, p_value::bigint)
    else p_price
  end
$$;
grant execute on function public.offer_price(bigint, text, numeric) to authenticated;

-- Sale lines remember the regular price and the offer used.
alter table public.sale_items add column regular_price bigint, add column offer_id uuid references public.offers(id);
grant select (regular_price, offer_id) on public.sale_items to authenticated;
update public.sale_items set regular_price = selling_price_at_sale where regular_price is null;

-- ---------------------------------------------------------------------------
-- make_sale, now applying offers (otherwise unchanged from 0004).
-- ---------------------------------------------------------------------------
create or replace function public.make_sale(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_user uuid := auth.uid();
  v_owner boolean := public.is_owner();
  v_mode text := payload->>'payment_mode';
  v_discount bigint := coalesce(nullif(payload->>'discount', '')::bigint, 0);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_approver uuid;
  v_customer uuid;
  v_sale uuid;
  v_item jsonb;
  v_qty int;
  v_price bigint;
  v_regular bigint;
  v_offer uuid;
  v_offer_price bigint;
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
      select v.id, v.selling_price, v.barcode, v.size, p.category_id into v_variant
        from public.variants v join public.products p on p.id = v.product_id
        where v.id = (v_item->>'variant_id')::uuid and v.shop_id = v_shop and v.deleted_at is null
        for update of v;
      if v_variant.id is null then raise exception 'item_not_found'; end if;
      v_regular := v_variant.selling_price;

      -- Best running offer for this item's category, if any.
      v_offer := null;
      select o.id, public.offer_price(v_regular, o.kind, o.value) into v_offer, v_offer_price
        from public.offers o
        where o.shop_id = v_shop and o.active and o.deleted_at is null
          and v_today between o.starts_on and o.ends_on
          and (o.category_ids is null or cardinality(o.category_ids) = 0 or v_variant.category_id = any(o.category_ids))
        order by public.offer_price(v_regular, o.kind, o.value), o.created_at
        limit 1;
      if v_offer is not null and v_offer_price < v_regular then
        v_price := v_offer_price;
      else
        v_offer := null;
        v_price := v_regular;
      end if;

      update public.variants set stock_qty = stock_qty - v_qty where id = v_variant.id
        returning stock_qty into v_new_stock;
      v_stock := v_stock || jsonb_build_object('variant_id', v_variant.id, 'stock_qty', v_new_stock);
      if v_new_stock < 0 then
        v_negative := v_negative || jsonb_build_object('barcode', v_variant.barcode, 'stock_qty', v_new_stock);
      end if;

      insert into public.sale_items (shop_id, sale_id, variant_id, qty, selling_price_at_sale, regular_price, offer_id,
                                     size, created_by)
        values (v_shop, v_sale, v_variant.id, v_qty, v_price, v_regular, v_offer, v_variant.size, v_user);
    else
      select id into v_category from public.categories
        where id = nullif(v_item->>'category_id', '')::uuid and shop_id = v_shop and deleted_at is null;
      if v_category is null then raise exception 'category_not_found'; end if;
      v_price := nullif(v_item->>'price', '')::bigint;
      if v_price is null or v_price <= 0 then raise exception 'bad_price'; end if;
      insert into public.sale_items (shop_id, sale_id, variant_id, category_id, size, description, qty,
                                     selling_price_at_sale, regular_price, created_by)
        values (v_shop, v_sale, null, v_category, nullif(trim(coalesce(v_item->>'size', '')), ''),
                nullif(trim(coalesce(v_item->>'description', '')), ''), v_qty, v_price, v_price, v_user);
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

-- ---------------------------------------------------------------------------
-- Day summary gains offer discounts (pieces sold below their regular price).
-- ---------------------------------------------------------------------------
create or replace function public.day_summary(p_date date) returns jsonb
language sql stable security invoker set search_path = public as $$
  with s as (
    select * from public.sales
    where shop_id = public.current_shop_id() and deleted_at is null
      and sold_at >= public.ist_day_start(p_date) and sold_at < public.ist_day_start(p_date + 1)
  ),
  lines as (
    select si.qty, si.selling_price_at_sale, si.regular_price, si.offer_id
    from public.sale_items si join s on s.id = si.sale_id
    where si.deleted_at is null
  ),
  ce as (
    select * from public.credit_entries
    where shop_id = public.current_shop_id() and deleted_at is null
      and entry_date >= public.ist_day_start(p_date) and entry_date < public.ist_day_start(p_date + 1)
  )
  select jsonb_build_object(
    'date', p_date,
    'bills', (select count(*) from s),
    'cash', (select coalesce(sum(total), 0) from s where payment_mode = 'cash'),
    'upi', (select coalesce(sum(total), 0) from s where payment_mode = 'upi'),
    'udhaar_sales', (select coalesce(sum(total), 0) from s where payment_mode = 'udhaar'),
    'net_sales', (select coalesce(sum(total), 0) from s),
    'discounts', (select coalesce(sum(discount_total), 0) from s),
    'discount_bills', (select count(*) from s where discount_total > 0),
    'offer_discounts', (select coalesce(sum(qty * (regular_price - selling_price_at_sale)), 0) from lines
                        where offer_id is not null and qty > 0),
    'returns', (select coalesce(sum(-qty * selling_price_at_sale), 0) from lines where qty < 0),
    'udhaar_given', (select coalesce(sum(amount), 0) from ce where entry_type = 'credit_sale' and not is_opening),
    'udhaar_collected_cash', (select coalesce(sum(amount), 0) from ce where entry_type = 'payment' and payment_mode = 'cash'),
    'udhaar_collected_upi', (select coalesce(sum(amount), 0) from ce where entry_type = 'payment' and payment_mode = 'upi')
  )
$$;

-- ---------------------------------------------------------------------------
-- Discount report (owner): by day and staff member.
-- ---------------------------------------------------------------------------
create or replace function public.report_discounts(p_from date, p_to date)
returns table (day date, staff_id uuid, staff text, bills bigint, bills_with_discount bigint,
               bill_discount bigint, offer_discount bigint, approved_by_pin bigint)
language sql stable security definer set search_path = public as $$
  with s as (
    select s.* from public.sales s
    where s.shop_id = public.current_shop_id() and public.is_owner() and s.deleted_at is null
      and s.sold_at >= public.ist_day_start(p_from) and s.sold_at < public.ist_day_start(p_to + 1)
  ),
  offer as (
    select si.sale_id, sum(si.qty * (si.regular_price - si.selling_price_at_sale)) as amount
    from public.sale_items si join s on s.id = si.sale_id
    where si.deleted_at is null and si.offer_id is not null and si.qty > 0
    group by 1
  )
  select (s.sold_at at time zone 'Asia/Kolkata')::date, s.staff_id, pr.name,
         count(*), count(*) filter (where s.discount_total > 0),
         coalesce(sum(s.discount_total), 0)::bigint, coalesce(sum(offer.amount), 0)::bigint,
         count(*) filter (where s.discount_total > 0 and s.discount_approved_by is distinct from s.staff_id)
  from s
  left join offer on offer.sale_id = s.id
  left join public.profiles pr on pr.id = s.staff_id
  group by 1, 2, 3
  order by 1, 3
$$;
revoke execute on function public.report_discounts(date, date) from public, anon;
grant execute on function public.report_discounts(date, date) to authenticated;
