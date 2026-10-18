-- Fix-a-mistake tools (owner only) and Phase 5 reorder data.

-- ---------------------------------------------------------------------------
-- adjust_stock: owner corrects a size's stock, with a reason.
--   p_mode 'set'    -> p_value is the counted quantity
--   p_mode 'change' -> p_value is added (+) or removed (-)
-- Reasons: damage, theft, count_correction, return (returned to supplier).
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(p_variant uuid, p_mode text, p_value int, p_reason text, p_notes text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_stock int;
  v_change int;
begin
  if not public.is_owner() then raise exception 'owner_only'; end if;
  if p_reason is null or p_reason not in ('damage', 'theft', 'count_correction', 'return') then raise exception 'bad_reason'; end if;
  if p_mode not in ('set', 'change') or p_value is null then raise exception 'bad_qty'; end if;
  if p_mode = 'set' and p_value < 0 then raise exception 'bad_qty'; end if;

  select stock_qty into v_stock from public.variants
    where id = p_variant and shop_id = v_shop and deleted_at is null for update;
  if v_stock is null then raise exception 'item_not_found'; end if;

  v_change := case when p_mode = 'set' then p_value - v_stock else p_value end;
  if v_change = 0 then raise exception 'no_change'; end if;

  update public.variants set stock_qty = stock_qty + v_change where id = p_variant;
  insert into public.stock_adjustments (shop_id, variant_id, qty_change, reason, notes, created_by)
    values (v_shop, p_variant, v_change, p_reason, nullif(trim(coalesce(p_notes, '')), ''), auth.uid());
  insert into public.audit_log (shop_id, action, table_name, row_id, details)
    values (v_shop, 'stock_adjusted', 'variants', p_variant,
            jsonb_build_object('change', v_change, 'reason', p_reason, 'before', v_stock));
  return v_stock + v_change;
end $$;

-- ---------------------------------------------------------------------------
-- cancel_purchase: owner cancels a wrongly entered supplier bill.
-- Its pieces come off the stock again and the bill comes off the supplier's
-- account. Money already paid on it stays as a credit with that supplier.
-- Nothing is deleted: the bill and its lines are marked cancelled.
-- Returns the sizes whose stock went below zero (already sold).
-- ---------------------------------------------------------------------------
alter table public.purchases add column cancel_reason text;
grant select (cancel_reason) on public.purchases to authenticated;

create or replace function public.cancel_purchase(p_purchase uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_bill public.purchases;
  v_line record;
  v_new int;
  v_negative jsonb := '[]'::jsonb;
begin
  if not public.is_owner() then raise exception 'owner_only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  select * into v_bill from public.purchases where id = p_purchase and shop_id = v_shop for update;
  if v_bill.id is null then raise exception 'purchase_not_found'; end if;
  if v_bill.deleted_at is not null then raise exception 'already_cancelled'; end if;

  for v_line in
    select pi.id, pi.variant_id, pi.qty, v.barcode from public.purchase_items pi
    join public.variants v on v.id = pi.variant_id
    where pi.purchase_id = p_purchase and pi.deleted_at is null
  loop
    update public.variants set stock_qty = stock_qty - v_line.qty where id = v_line.variant_id
      returning stock_qty into v_new;
    if v_new < 0 then
      v_negative := v_negative || jsonb_build_object('barcode', v_line.barcode, 'stock_qty', v_new);
    end if;
    update public.purchase_items set deleted_at = now() where id = v_line.id;
  end loop;

  update public.suppliers set balance = balance - v_bill.total where id = v_bill.supplier_id;
  update public.purchases set deleted_at = now(), cancel_reason = trim(p_reason) where id = p_purchase;

  insert into public.audit_log (shop_id, action, table_name, row_id, details)
    values (v_shop, 'purchase_cancelled', 'purchases', p_purchase,
            jsonb_build_object('total', v_bill.total, 'paid', v_bill.amount_paid, 'reason', trim(p_reason)));
  return jsonb_build_object('negative', v_negative);
end $$;

-- pay_purchase must not take payments on a cancelled bill (it already checks
-- deleted_at is null), and receive/labels screens already skip cancelled lines.

revoke execute on function public.adjust_stock(uuid, text, int, text, text), public.cancel_purchase(uuid, text)
  from public, anon;
grant execute on function public.adjust_stock(uuid, text, int, text, text), public.cancel_purchase(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- reorder_rows: one row per live size with what the reorder screen needs.
-- Runs with the caller's rights and returns no money, so staff can use it.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_rows(p_days int)
returns table (
  variant_id uuid, barcode text, product_id uuid, product text, product_hi text, product_en text,
  category_hi text, category_en text, category_sort int, size text, stock int, min_stock int,
  sold bigint, last_sold date, supplier_id uuid, supplier text, supplier_phone text, last_received date
)
language sql stable security invoker set search_path = public as $$
  with v as (
    select v.* from public.variants v
    join public.products p on p.id = v.product_id and p.deleted_at is null
    where v.shop_id = public.current_shop_id() and v.deleted_at is null
  ),
  sold as (
    select si.variant_id, sum(si.qty) as sold
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.shop_id = public.current_shop_id() and s.deleted_at is null and si.deleted_at is null
      and si.variant_id is not null and s.sold_at >= now() - make_interval(days => greatest(p_days, 1))
    group by 1
  ),
  last_sale as (
    select si.variant_id, max(s.sold_at at time zone 'Asia/Kolkata')::date as d
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.shop_id = public.current_shop_id() and s.deleted_at is null and si.deleted_at is null
      and si.variant_id is not null and si.qty > 0
    group by 1
  ),
  last_buy as (
    select distinct on (pi.variant_id) pi.variant_id, pu.supplier_id, pu.bill_date
    from public.purchase_items pi join public.purchases pu on pu.id = pi.purchase_id
    where pu.shop_id = public.current_shop_id() and pu.deleted_at is null and pi.deleted_at is null
    order by pi.variant_id, pu.bill_date desc, pi.created_at desc
  )
  select v.id, v.barcode, p.id, p.name, p.name_hi, p.name_en, c.name_hi, c.name_en, c.sort_order, v.size,
         v.stock_qty, v.min_stock, greatest(coalesce(sold.sold, 0), 0), last_sale.d,
         lb.supplier_id, su.name, su.phone, lb.bill_date
  from v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  left join sold on sold.variant_id = v.id
  left join last_sale on last_sale.variant_id = v.id
  left join last_buy lb on lb.variant_id = v.id
  left join public.suppliers su on su.id = lb.supplier_id
$$;
grant execute on function public.reorder_rows(int) to authenticated;
