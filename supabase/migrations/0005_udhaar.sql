-- Phase 3: udhaar (customer credit).
--
--   * A customer's balance only changes through make_sale(), record_payment()
--     or add_customer() (opening balance). Nobody can type a balance in.
--   * Payments record how they came in (cash / UPI) for the daily close.
--   * customer_aging shows who owes what and since when: payments are applied
--     to the oldest udhaar first, so "since" is the date of the oldest unpaid one.

alter table public.credit_entries
  add column payment_mode text check (payment_mode in ('cash', 'upi'));

-- Opening balance from the old notebook is a credit with no sale.
alter table public.credit_entries
  add column is_opening boolean not null default false;

-- Balances are not directly editable; names and phones are.
revoke insert, update on public.customers from authenticated;
grant insert (name, phone) on public.customers to authenticated;
grant update (name, phone) on public.customers to authenticated;

create index on public.credit_entries (customer_id, entry_date);

-- ---------------------------------------------------------------------------
-- add_customer: new customer, optionally with udhaar carried over from the
-- notebook (amount + the date it started).
-- ---------------------------------------------------------------------------
create or replace function public.add_customer(p_name text, p_phone text, p_opening bigint, p_since date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_id uuid;
begin
  if v_shop is null then raise exception 'not_logged_in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if p_opening is not null and p_opening < 0 then raise exception 'bad_amount'; end if;
  if p_since is not null and p_since > current_date then raise exception 'bad_date'; end if;

  insert into public.customers (shop_id, name, phone, outstanding, created_by)
    values (v_shop, trim(p_name), nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''),
            coalesce(p_opening, 0), auth.uid())
    returning id into v_id;

  if coalesce(p_opening, 0) > 0 then
    insert into public.credit_entries (shop_id, customer_id, entry_type, amount, entry_date, is_opening, notes, created_by)
      values (v_shop, v_id, 'credit_sale', p_opening,
              coalesce(p_since, current_date)::timestamp at time zone 'Asia/Kolkata', true, 'opening balance', auth.uid());
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- record_payment: customer pays back part or all of their udhaar.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(p_customer uuid, p_amount bigint, p_mode text, p_notes text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := public.current_shop_id();
  v_out bigint;
begin
  if v_shop is null then raise exception 'not_logged_in'; end if;
  if p_mode is null or p_mode not in ('cash', 'upi') then raise exception 'bad_payment_mode'; end if;

  select outstanding into v_out from public.customers
    where id = p_customer and shop_id = v_shop and deleted_at is null for update;
  if v_out is null then raise exception 'customer_not_found'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_out then raise exception 'bad_amount'; end if;

  insert into public.credit_entries (shop_id, customer_id, entry_type, amount, payment_mode, notes, created_by)
    values (v_shop, p_customer, 'payment', p_amount, p_mode, nullif(trim(coalesce(p_notes, '')), ''), auth.uid());
  update public.customers set outstanding = outstanding - p_amount where id = p_customer;
  return v_out - p_amount;
end $$;

revoke execute on function public.add_customer(text, text, bigint, date), public.record_payment(uuid, bigint, text, text)
  from public, anon;
grant execute on function public.add_customer(text, text, bigint, date), public.record_payment(uuid, bigint, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Who owes what, and since when. Runs with the caller's rights, so Row Level
-- Security keeps each shop to its own customers.
-- ---------------------------------------------------------------------------
create view public.customer_aging with (security_invoker = true) as
with credits as (
  select customer_id, entry_date,
         sum(amount) over (partition by customer_id order by entry_date, id) as running
  from public.credit_entries
  where entry_type = 'credit_sale' and deleted_at is null
),
paid as (
  select customer_id, sum(amount) as total_paid, max(entry_date) as last_payment
  from public.credit_entries
  where entry_type = 'payment' and deleted_at is null
  group by customer_id
)
select c.id, c.shop_id, c.name, c.phone, c.outstanding, c.created_at,
       case when c.outstanding > 0 then
         (select min(cr.entry_date) from credits cr
           where cr.customer_id = c.id and cr.running > coalesce(p.total_paid, 0))
       end as oldest_unpaid,
       p.last_payment
from public.customers c
left join paid p on p.customer_id = c.id
where c.deleted_at is null;

grant select on public.customer_aging to authenticated;
