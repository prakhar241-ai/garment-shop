-- Master (platform admin) users: the person who runs the app for all shops.
-- They create shops, shop owners and staff, reset PINs and switch accounts
-- on or off. They have no shop of their own and see no shop's sales.
--
-- The table is invisible to app users (no grants); master users are added
-- only with `npm run admin:create`, never from the app.

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Master',
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

-- Lets the server ask "is the logged-in person a master user?" with the
-- user's own login, without exposing the table.
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
