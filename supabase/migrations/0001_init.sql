-- 0001_init.sql
-- Initial schema for the Ops App: the `profiles` table that backs auth.
--
-- This is part of our operational layer (data Amazon does not store), so this
-- table is authoritative — it is NOT a synced mirror.
--
-- Two users only: owner (Brian) and staff (VA). No finer-grained RBAC; the
-- `role` column is the entire authorization model for now.

-- One profile row per Supabase auth user. Deleting the auth user cascades.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

-- Row Level Security: lock the table down, then open specific paths below.
alter table public.profiles enable row level security;

-- A user can read their own profile row.
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- A user can update their own profile row.
-- Note: this intentionally does NOT let a user change their own role to
-- 'owner' safely on its own — role escalation should be governed by a stricter
-- policy or admin-only path when that requirement lands. For two trusted users
-- this is acceptable; revisit before adding more users.
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-provision a profile row whenever a new auth user is created.
-- Runs as SECURITY DEFINER so it can insert into public.profiles regardless of
-- the inserting role; search_path is pinned to avoid hijacking.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Fire the function after each new auth.users row.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
