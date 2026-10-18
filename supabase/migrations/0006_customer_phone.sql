-- Store customer phones the same way however they were typed or wherever they
-- were entered: "+91 98765-43210", "098765 43210" and "9876543210" all become
-- "9876543210", so search and WhatsApp links always work.

create or replace function public.normalize_customer_phone() returns trigger
language plpgsql as $$
declare
  d text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
begin
  if length(d) = 12 and left(d, 2) = '91' then d := substr(d, 3); end if;
  if length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  new.phone := nullif(d, '');
  return new;
end $$;

create trigger normalize_customer_phone before insert or update of phone on public.customers
  for each row execute function public.normalize_customer_phone();

update public.customers set phone = phone where phone is not null;
