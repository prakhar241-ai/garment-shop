-- Supplier phones get the same clean-up as customer phones (10 digits), so
-- the "send order on WhatsApp" link opens the right chat.
create trigger normalize_supplier_phone before insert or update of phone on public.suppliers
  for each row execute function public.normalize_customer_phone();

update public.suppliers set phone = phone where phone is not null;
-- Anything that is not a mobile number after clean-up is dropped.
update public.suppliers set phone = null where phone is not null and phone !~ '^[6-9][0-9]{9}$';
