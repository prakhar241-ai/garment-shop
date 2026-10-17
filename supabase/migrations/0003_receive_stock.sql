-- Phase 1: receiving stock.
--
-- All stock-in goes through receive_purchase(), a SECURITY DEFINER function, so:
--   * staff can enter a bill (including cost prices) without being able to read costs back
--   * staff can never set or change a selling price: new sizes get the suggested
--     price computed here, existing sizes keep their price
--   * barcodes, stock, purchase totals and supplier balances change together or not at all

-- The shop chose "round up to ₹10". New shops default to it too.
alter table public.shops alter column settings set default '{"rounding": "10", "currency": "INR"}'::jsonb;
update public.shops set settings = jsonb_set(settings, '{rounding}', '"10"') where code = 'S1';

-- One live variant per product + size (+ colour), so two people receiving the
-- same new size at once cannot create duplicate barcodes for it.
create unique index variants_one_per_size on public.variants (shop_id, product_id, size, coalesce(color, ''))
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Supplier balances are owner-only (they reveal what stock cost).
-- ---------------------------------------------------------------------------
revoke select, update on public.suppliers from authenticated;
grant select (id, shop_id, name, phone, notes, created_at, updated_at, created_by, deleted_at)
  on public.suppliers to authenticated;
grant update (name, phone, notes) on public.suppliers to authenticated;

create view public.owner_suppliers as
  select id, shop_id, name, phone, notes, balance, created_at, deleted_at
  from public.suppliers
  where shop_id = public.current_shop_id() and public.is_owner();
grant select on public.owner_suppliers to authenticated;

-- ---------------------------------------------------------------------------
-- Pricing, mirrored from src/lib/pricing.ts (tests check both agree).
-- ---------------------------------------------------------------------------
create or replace function public.round_price(paise bigint, rule text) returns bigint
language plpgsql immutable as $$
declare
  rupees bigint;
  step int;
  endings int[];
  base bigint;
  e int;
begin
  if paise is null or paise <= 0 then return 0; end if;
  rupees := ceil(paise / 100.0)::bigint;
  if rule = 'none' then return rupees * 100; end if;
  if rule = '10' then return (ceil(rupees / 10.0)::bigint * 10) * 100; end if;
  if rule = '9' then step := 10; endings := array[9];
  elsif rule = '99' then step := 100; endings := array[99];
  else step := 100; endings := array[49, 99];  -- '49_99' and anything unknown
  end if;
  base := (rupees / step) * step;
  foreach e in array endings loop
    if base + e >= rupees then return (base + e) * 100; end if;
  end loop;
  return (base + step + endings[1]) * 100;
end $$;

create or replace function public.suggest_price(cost bigint, markup numeric, rule text) returns bigint
language plpgsql immutable as $$
declare
  bp bigint;
begin
  if cost is null or cost <= 0 then return 0; end if;
  bp := round(markup * 100);
  return public.round_price(ceil((cost * (10000 + bp))::numeric / 10000)::bigint, rule);
end $$;

grant execute on function public.round_price(bigint, text), public.suggest_price(bigint, numeric, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- receive_purchase(payload)
--
-- payload = {
--   supplier_id?: uuid,  new_supplier?: { name, phone? },
--   bill_number?: text,  bill_date?: 'YYYY-MM-DD',  notes?: text,
--   payment_mode: 'bill' | 'cash' | 'mixed',  amount_paid?: paise (for 'mixed'),
--   items: [{
--     product_id?: uuid,  new_product?: { category_id, name, name_hi?, name_en?, color? },
--     cost_price: paise,  selling_price?: paise (OWNER ONLY, ignored for staff),
--     sizes: [{ size: text, qty: int }]
--   }]
-- }
-- returns { purchase_id, labels: [{ variant_id, qty }] }
--
-- payment_mode: 'bill' = nothing paid yet (all goes on the supplier's account),
-- 'cash' = paid in full now, 'mixed' = amount_paid now, rest on account.
-- ---------------------------------------------------------------------------
create or replace function public.receive_purchase(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_user uuid := auth.uid();
  v_owner boolean := public.is_owner();
  v_rule text;
  v_code text;
  v_supplier uuid;
  v_purchase uuid;
  v_mode text := coalesce(payload->>'payment_mode', 'bill');
  v_paid bigint;
  v_total bigint := 0;
  v_lines int := 0;
  v_item jsonb;
  v_size_row jsonb;
  v_product uuid;
  v_category uuid;
  v_markup numeric;
  v_min int;
  v_cost bigint;
  v_given_price bigint;
  v_price bigint;
  v_qty int;
  v_size text;
  v_variant uuid;
  v_old_price bigint;
  v_seq int;
  v_labels jsonb := '[]'::jsonb;
begin
  if v_shop is null then raise exception 'not_logged_in'; end if;
  if v_mode not in ('bill', 'cash', 'mixed') then raise exception 'bad_payment_mode'; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') = 0 then
    raise exception 'no_items';
  end if;

  select coalesce(settings->>'rounding', '10'), code into v_rule, v_code from public.shops where id = v_shop;

  -- Supplier: existing one of this shop, or a new one.
  if nullif(payload->>'supplier_id', '') is not null then
    select id into v_supplier from public.suppliers
      where id = (payload->>'supplier_id')::uuid and shop_id = v_shop and deleted_at is null;
    if v_supplier is null then raise exception 'supplier_not_found'; end if;
  else
    if coalesce(trim(payload->'new_supplier'->>'name'), '') = '' then raise exception 'supplier_required'; end if;
    insert into public.suppliers (shop_id, name, phone, created_by)
      values (v_shop, trim(payload->'new_supplier'->>'name'),
              nullif(trim(coalesce(payload->'new_supplier'->>'phone', '')), ''), v_user)
      returning id into v_supplier;
  end if;

  insert into public.purchases (shop_id, supplier_id, bill_number, bill_date, payment_mode, notes, created_by)
    values (v_shop, v_supplier, nullif(trim(coalesce(payload->>'bill_number', '')), ''),
            coalesce(nullif(payload->>'bill_date', '')::date, current_date), v_mode,
            nullif(trim(coalesce(payload->>'notes', '')), ''), v_user)
    returning id into v_purchase;

  for v_item in select value from jsonb_array_elements(payload->'items') loop
    v_cost := (v_item->>'cost_price')::bigint;
    if v_cost is null or v_cost < 0 then raise exception 'bad_cost'; end if;

    -- Product: existing one of this shop, or a new one in one of this shop's categories.
    v_product := null;
    if nullif(v_item->>'product_id', '') is not null then
      select id, category_id into v_product, v_category from public.products
        where id = (v_item->>'product_id')::uuid and shop_id = v_shop and deleted_at is null;
      if v_product is null then raise exception 'product_not_found'; end if;
    else
      select id into v_category from public.categories
        where id = nullif(v_item->'new_product'->>'category_id', '')::uuid and shop_id = v_shop and deleted_at is null;
      if v_category is null then raise exception 'category_not_found'; end if;
      if coalesce(trim(v_item->'new_product'->>'name'), '') = '' then raise exception 'product_name_required'; end if;
      insert into public.products (shop_id, category_id, name, name_hi, name_en, color, created_by)
        values (v_shop, v_category, trim(v_item->'new_product'->>'name'),
                nullif(trim(coalesce(v_item->'new_product'->>'name_hi', '')), ''),
                nullif(trim(coalesce(v_item->'new_product'->>'name_en', '')), ''),
                nullif(trim(coalesce(v_item->'new_product'->>'color', '')), ''), v_user)
        returning id into v_product;
    end if;

    select default_markup_percent, default_min_stock into v_markup, v_min
      from public.categories where id = v_category;

    -- Only the owner's price is used. Staff-sent prices are ignored.
    v_given_price := case when v_owner then nullif(v_item->>'selling_price', '')::bigint end;
    if v_given_price is not null and v_given_price < 0 then raise exception 'bad_price'; end if;

    for v_size_row in select value from jsonb_array_elements(coalesce(v_item->'sizes', '[]'::jsonb)) loop
      v_qty := (v_size_row->>'qty')::int;
      v_size := trim(coalesce(v_size_row->>'size', ''));
      if v_qty is null or v_qty = 0 then continue; end if;
      if v_qty < 0 then raise exception 'bad_qty'; end if;
      if v_size = '' then raise exception 'bad_size'; end if;

      v_variant := null;
      select id, selling_price into v_variant, v_old_price from public.variants
        where shop_id = v_shop and product_id = v_product and size = v_size and color is null and deleted_at is null
        for update;

      if v_variant is null then
        update public.shops set barcode_seq = barcode_seq + 1 where id = v_shop returning barcode_seq into v_seq;
        v_price := coalesce(v_given_price, public.suggest_price(v_cost, v_markup, v_rule));
        insert into public.variants (shop_id, product_id, size, barcode, cost_price, selling_price,
                                     stock_qty, min_stock, created_by)
          values (v_shop, v_product, v_size, v_code || '-' || lpad(v_seq::text, 5, '0'), v_cost, v_price,
                  v_qty, v_min, v_user)
          returning id into v_variant;
        insert into public.price_changes (shop_id, variant_id, old_price, new_price, reason, created_by)
          values (v_shop, v_variant, 0, v_price, 'initial', v_user);
      else
        update public.variants
          set stock_qty = stock_qty + v_qty,
              cost_price = v_cost,
              selling_price = coalesce(v_given_price, selling_price)
          where id = v_variant;
        if v_given_price is not null and v_given_price <> v_old_price then
          insert into public.price_changes (shop_id, variant_id, old_price, new_price, reason, created_by)
            values (v_shop, v_variant, v_old_price, v_given_price, 'correction', v_user);
        end if;
      end if;

      insert into public.purchase_items (shop_id, purchase_id, variant_id, qty, cost_price, created_by)
        values (v_shop, v_purchase, v_variant, v_qty, v_cost, v_user);
      v_total := v_total + v_qty * v_cost;
      v_lines := v_lines + 1;
      v_labels := v_labels || jsonb_build_object('variant_id', v_variant, 'qty', v_qty);
    end loop;
  end loop;

  if v_lines = 0 then raise exception 'no_items'; end if;

  v_paid := case v_mode
    when 'cash' then v_total
    when 'bill' then 0
    else coalesce(nullif(payload->>'amount_paid', '')::bigint, 0)
  end;
  if v_paid < 0 or v_paid > v_total then raise exception 'bad_amount'; end if;

  update public.purchases set total = v_total, amount_paid = v_paid where id = v_purchase;
  update public.suppliers set balance = balance + v_total - v_paid where id = v_supplier;

  insert into public.audit_log (shop_id, action, table_name, row_id, details, created_by)
    values (v_shop, 'purchase_received', 'purchases', v_purchase,
            jsonb_build_object('lines', v_lines, 'by_owner', v_owner), v_user);

  return jsonb_build_object('purchase_id', v_purchase, 'labels', v_labels);
end $$;

-- ---------------------------------------------------------------------------
-- pay_purchase: owner records a later payment against a bill.
-- ---------------------------------------------------------------------------
create or replace function public.pay_purchase(p_purchase uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_row public.purchases;
begin
  if not public.is_owner() then raise exception 'owner_only'; end if;
  select * into v_row from public.purchases
    where id = p_purchase and shop_id = v_shop and deleted_at is null for update;
  if v_row.id is null then raise exception 'purchase_not_found'; end if;
  if p_amount is null or p_amount <= 0 or v_row.amount_paid + p_amount > v_row.total then
    raise exception 'bad_amount';
  end if;
  update public.purchases
    set amount_paid = amount_paid + p_amount,
        -- Paid in full in one go counts as cash; anything else is part-paid.
        payment_mode = case when amount_paid = 0 and p_amount = total then 'cash' else 'mixed' end
    where id = p_purchase;
  update public.suppliers set balance = balance - p_amount where id = v_row.supplier_id;
  insert into public.audit_log (shop_id, action, table_name, row_id, details)
    values (v_shop, 'purchase_paid', 'purchases', p_purchase, jsonb_build_object('amount', p_amount));
end $$;

revoke execute on function public.receive_purchase(jsonb), public.pay_purchase(uuid, bigint) from public, anon;
grant execute on function public.receive_purchase(jsonb), public.pay_purchase(uuid, bigint) to authenticated;

-- Demo shop: re-price the sample stock with the ₹10 rule so it matches new bills.
update public.variants v
  set selling_price = public.suggest_price(v.cost_price, c.default_markup_percent, '10')
  from public.products p, public.categories c, public.shops s
  where v.product_id = p.id and p.category_id = c.id and v.shop_id = s.id and s.code = 'S1';
