-- Shop names and people's names can carry a Hindi and an English version, like
-- products do. The app shows the one matching the user's language and falls
-- back to the other, then to `name` as entered.

alter table public.shops add column name_hi text, add column name_en text;
alter table public.profiles add column name_hi text, add column name_en text;

-- Same rule as `name`: users may edit their own display names, nothing else.
grant update (name_hi, name_en) on public.profiles to authenticated;

-- Demo shop (S1) and the test shop: fill in both languages.
update public.shops set name_hi = 'डेमो गारमेंट्स', name_en = 'Demo Garments' where code = 'S1';
update public.shops set name_hi = 'टेस्ट दुकान B', name_en = 'Test Shop B' where code = 'TB';
update public.profiles set name_hi = 'मालिक (डेमो)', name_en = 'Owner (Demo)' where phone = '9000000001';
update public.profiles set name_hi = 'स्टाफ (डेमो)', name_en = 'Staff (Demo)' where phone = '9000000002';
