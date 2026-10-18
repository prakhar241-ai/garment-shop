-- Sale-line export: return both category names so the CSV can use the
-- reader's language (it returned English only).
drop function public.report_sale_lines(date, date);

create function public.report_sale_lines(p_from date, p_to date)
returns table (sold_at timestamptz, sale_id uuid, payment_mode text, customer text, staff text, barcode text,
               product text, product_hi text, product_en text, category_hi text, category_en text, size text,
               qty int, price bigint, line_total bigint, bill_discount bigint, cost bigint)
language sql stable security definer set search_path = public as $$
  select s.sold_at, s.id, s.payment_mode, cu.name, pr.name, v.barcode,
         coalesce(p.name, si.description), p.name_hi, p.name_en,
         coalesce(c1.name_hi, c2.name_hi), coalesce(c1.name_en, c2.name_en), coalesce(si.size, v.size),
         si.qty, si.selling_price_at_sale, si.qty * si.selling_price_at_sale, s.discount_total,
         si.qty * si.cost_price_at_sale
  from public.sales s
  join public.sale_items si on si.sale_id = s.id and si.deleted_at is null
  left join public.variants v on v.id = si.variant_id
  left join public.products p on p.id = v.product_id
  left join public.categories c1 on c1.id = p.category_id
  left join public.categories c2 on c2.id = si.category_id
  left join public.customers cu on cu.id = s.customer_id
  left join public.profiles pr on pr.id = s.staff_id
  where s.shop_id = public.current_shop_id() and public.is_owner() and s.deleted_at is null
    and s.sold_at >= public.ist_day_start(p_from) and s.sold_at < public.ist_day_start(p_to + 1)
  order by s.sold_at, s.id
$$;
revoke execute on function public.report_sale_lines(date, date) from public, anon;
grant execute on function public.report_sale_lines(date, date) to authenticated;
