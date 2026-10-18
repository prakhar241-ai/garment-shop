-- reorder_rows read every variants column, including cost_price, which staff
-- may not select. List only the columns it needs.

create or replace function public.reorder_rows(p_days int)
returns table (
  variant_id uuid, barcode text, product_id uuid, product text, product_hi text, product_en text,
  category_hi text, category_en text, category_sort int, size text, stock int, min_stock int,
  sold bigint, last_sold date, supplier_id uuid, supplier text, supplier_phone text, last_received date
)
language sql stable security invoker set search_path = public as $$
  with v as (
    select v.id, v.product_id, v.barcode, v.size, v.stock_qty, v.min_stock from public.variants v
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
