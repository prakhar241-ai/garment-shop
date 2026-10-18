-- Phase 4: daily close and reports.
--
-- Days are Indian calendar days. Report functions are SECURITY DEFINER and
-- owner-only, because they need cost prices; day_summary() runs with the
-- caller's rights (no costs in it), so staff can close the day too.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.ist_day_start(d date) returns timestamptz
language sql immutable as $$ select (d::timestamp at time zone 'Asia/Kolkata') $$;

-- ---------------------------------------------------------------------------
-- Day summary: what the cash drawer should hold, and the day's numbers.
-- ---------------------------------------------------------------------------
create or replace function public.day_summary(p_date date) returns jsonb
language sql stable security invoker set search_path = public as $$
  with s as (
    select * from public.sales
    where shop_id = public.current_shop_id() and deleted_at is null
      and sold_at >= public.ist_day_start(p_date) and sold_at < public.ist_day_start(p_date + 1)
  ),
  ret as (
    select coalesce(sum(-si.qty * si.selling_price_at_sale), 0) as returns_value
    from public.sale_items si join s on s.id = si.sale_id
    where si.qty < 0 and si.deleted_at is null
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
    'returns', (select returns_value from ret),
    'udhaar_given', (select coalesce(sum(amount), 0) from ce where entry_type = 'credit_sale' and not is_opening),
    'udhaar_collected_cash', (select coalesce(sum(amount), 0) from ce where entry_type = 'payment' and payment_mode = 'cash'),
    'udhaar_collected_upi', (select coalesce(sum(amount), 0) from ce where entry_type = 'payment' and payment_mode = 'upi')
  )
$$;
grant execute on function public.day_summary(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily close: one row per shop per day; closing again the same day updates it.
-- ---------------------------------------------------------------------------
create table public.daily_closes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id),
  close_date date not null,
  opening_cash bigint not null default 0,
  cash_out bigint not null default 0,       -- expenses / supplier cash taken out of the drawer
  expected_cash bigint not null,
  counted_cash bigint not null,
  difference bigint not null,               -- counted - expected
  left_in_drawer bigint not null default 0, -- becomes tomorrow's opening cash
  summary jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id),
  deleted_at timestamptz,
  unique (shop_id, close_date)
);
create trigger touch_updated_at before update on public.daily_closes
  for each row execute function public.touch_updated_at();
alter table public.daily_closes enable row level security;
create policy daily_closes_select on public.daily_closes for select to authenticated
  using (shop_id = public.current_shop_id());
grant select on public.daily_closes to authenticated;

create or replace function public.close_day(p_date date, p_opening bigint, p_cash_out bigint, p_counted bigint,
                                            p_left bigint, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_sum jsonb;
  v_expected bigint;
  v_row public.daily_closes;
begin
  if v_shop is null then raise exception 'not_logged_in'; end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'bad_date'; end if;
  if least(p_opening, p_cash_out, p_counted, p_left) < 0 then raise exception 'bad_amount'; end if;
  if p_left > p_counted then raise exception 'bad_amount'; end if;

  v_sum := public.day_summary(p_date);
  v_expected := p_opening + (v_sum->>'cash')::bigint + (v_sum->>'udhaar_collected_cash')::bigint - p_cash_out;

  insert into public.daily_closes (shop_id, close_date, opening_cash, cash_out, expected_cash, counted_cash,
                                   difference, left_in_drawer, summary, notes, created_by)
    values (v_shop, p_date, p_opening, p_cash_out, v_expected, p_counted, p_counted - v_expected, p_left,
            v_sum, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    on conflict (shop_id, close_date) do update
      set opening_cash = excluded.opening_cash, cash_out = excluded.cash_out,
          expected_cash = excluded.expected_cash, counted_cash = excluded.counted_cash,
          difference = excluded.difference, left_in_drawer = excluded.left_in_drawer,
          summary = excluded.summary, notes = excluded.notes, created_by = excluded.created_by
    returning * into v_row;

  insert into public.audit_log (shop_id, action, table_name, row_id, details)
    values (v_shop, 'day_closed', 'daily_closes', v_row.id,
            jsonb_build_object('date', p_date, 'difference', v_row.difference));
  return to_jsonb(v_row);
end $$;
revoke execute on function public.close_day(date, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.close_day(date, bigint, bigint, bigint, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Sale lines with the bill discount spread over them in proportion to value,
-- so margins by category/size add up to the real takings. Owner-only users.
-- ---------------------------------------------------------------------------
create or replace function public.report_lines(p_from date, p_to date)
returns table (
  sale_id uuid, sold_day date, payment_mode text, variant_id uuid, product_id uuid, category_id uuid,
  size text, qty int, gross bigint, net numeric, cost bigint
)
language sql stable security definer set search_path = public as $$
  select s.id, (s.sold_at at time zone 'Asia/Kolkata')::date, s.payment_mode,
         si.variant_id, v.product_id, coalesce(p.category_id, si.category_id), coalesce(si.size, v.size),
         si.qty,
         si.qty * si.selling_price_at_sale,
         si.qty * si.selling_price_at_sale
           - case when s.discount_total > 0 and s.subtotal > 0
                  then s.discount_total::numeric * (si.qty * si.selling_price_at_sale) / s.subtotal
                  else 0 end,
         si.qty * si.cost_price_at_sale
  from public.sales s
  join public.sale_items si on si.sale_id = s.id and si.deleted_at is null
  left join public.variants v on v.id = si.variant_id
  left join public.products p on p.id = v.product_id
  where s.shop_id = public.current_shop_id() and public.is_owner() and s.deleted_at is null
    and s.sold_at >= public.ist_day_start(p_from) and s.sold_at < public.ist_day_start(p_to + 1)
$$;
revoke execute on function public.report_lines(date, date) from public, anon, authenticated;

-- Sales by day / week / month.
create or replace function public.report_sales(p_from date, p_to date, p_grain text)
returns table (bucket date, bills bigint, gross bigint, returns bigint, discounts bigint, net bigint,
               cost bigint, margin bigint)
language sql stable security definer set search_path = public as $$
  with l as (select * from public.report_lines(p_from, p_to)),
  b as (
    select date_trunc(case when p_grain in ('week', 'month') then p_grain else 'day' end, sold_day)::date as bucket, l.*
    from l
  )
  select bucket,
         count(distinct sale_id),
         coalesce(sum(gross) filter (where qty > 0), 0)::bigint,
         coalesce(-sum(gross) filter (where qty < 0), 0)::bigint,
         round(coalesce(sum(gross - net), 0))::bigint,
         round(sum(net))::bigint,
         sum(cost)::bigint,
         round(sum(net) - sum(cost))::bigint
  from b group by bucket order by bucket
$$;

-- By category.
create or replace function public.report_categories(p_from date, p_to date)
returns table (category_id uuid, name_hi text, name_en text, qty bigint, net bigint, cost bigint, margin bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name_hi, c.name_en, sum(l.qty), round(sum(l.net))::bigint, sum(l.cost)::bigint,
         round(sum(l.net) - sum(l.cost))::bigint
  from public.report_lines(p_from, p_to) l
  join public.categories c on c.id = l.category_id
  group by c.id, c.name_hi, c.name_en, c.sort_order
  order by sum(l.net) desc
$$;

-- By size.
create or replace function public.report_sizes(p_from date, p_to date)
returns table (size text, qty bigint, net bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(l.size, '—'), sum(l.qty), round(sum(l.net))::bigint
  from public.report_lines(p_from, p_to) l
  group by 1 order by sum(l.qty) desc
$$;

-- Products: sold in the period and stock now. Top movers sort by qty desc;
-- slow movers are products with stock that sold little or nothing.
create or replace function public.report_products(p_from date, p_to date)
returns table (product_id uuid, name text, name_hi text, name_en text, category_id uuid, sold bigint, net bigint,
               stock bigint, last_sold date)
language sql stable security definer set search_path = public as $$
  with sold as (
    select l.product_id, sum(l.qty) as sold, round(sum(l.net))::bigint as net
    from public.report_lines(p_from, p_to) l where l.product_id is not null group by 1
  ),
  last as (
    select v.product_id, max(s.sold_at at time zone 'Asia/Kolkata')::date as last_sold
    from public.sale_items si join public.sales s on s.id = si.sale_id
    join public.variants v on v.id = si.variant_id
    where s.shop_id = public.current_shop_id() and si.qty > 0 and s.deleted_at is null
    group by 1
  ),
  stock as (
    select product_id, sum(greatest(stock_qty, 0)) as stock from public.variants
    where shop_id = public.current_shop_id() and deleted_at is null group by 1
  )
  select p.id, p.name, p.name_hi, p.name_en, p.category_id, coalesce(sold.sold, 0), coalesce(sold.net, 0),
         coalesce(stock.stock, 0), last.last_sold
  from public.products p
  left join sold on sold.product_id = p.id
  left join stock on stock.product_id = p.id
  left join last on last.product_id = p.id
  where p.shop_id = public.current_shop_id() and public.is_owner() and p.deleted_at is null
$$;

-- Stock now, per size, with value at cost.
create or replace function public.report_stock()
returns table (variant_id uuid, barcode text, product text, name_hi text, name_en text, category_hi text,
               category_en text, size text, stock int, min_stock int, selling_price bigint, cost_price bigint,
               cost_value bigint, sale_value bigint)
language sql stable security definer set search_path = public as $$
  select v.id, v.barcode, p.name, p.name_hi, p.name_en, c.name_hi, c.name_en, v.size, v.stock_qty, v.min_stock,
         v.selling_price, v.cost_price,
         greatest(v.stock_qty, 0)::bigint * v.cost_price, greatest(v.stock_qty, 0)::bigint * v.selling_price
  from public.variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  where v.shop_id = public.current_shop_id() and public.is_owner() and v.deleted_at is null and p.deleted_at is null
  order by c.sort_order, p.name, v.barcode
$$;

-- Every sale line for export.
create or replace function public.report_sale_lines(p_from date, p_to date)
returns table (sold_at timestamptz, sale_id uuid, payment_mode text, customer text, staff text, barcode text,
               product text, category text, size text, qty int, price bigint, line_total bigint,
               bill_discount bigint, cost bigint)
language sql stable security definer set search_path = public as $$
  select s.sold_at, s.id, s.payment_mode, cu.name, pr.name, v.barcode,
         coalesce(p.name, si.description), coalesce(c1.name_en, c2.name_en), coalesce(si.size, v.size),
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

revoke execute on function public.report_sales(date, date, text), public.report_categories(date, date),
  public.report_sizes(date, date), public.report_products(date, date), public.report_stock(),
  public.report_sale_lines(date, date)
  from public, anon;
grant execute on function public.report_sales(date, date, text), public.report_categories(date, date),
  public.report_sizes(date, date), public.report_products(date, date), public.report_stock(),
  public.report_sale_lines(date, date)
  to authenticated;
