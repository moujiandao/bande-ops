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

-- A user can update their own profile row. RLS is row-level, not column-level,
-- so this alone would let a user set their own role to 'owner'. The
-- enforce_role_immutable trigger below pins `role` for any non-service-role
-- caller, so self-service updates to other columns stay open while role
-- changes are restricted to the server-side service role.
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Prevent privilege escalation: end users cannot change their own `role`.
-- Only the service role (server-side admin path) may mutate it. Without this,
-- profiles_update_own permits `update profiles set role='owner' where id=auth.uid()`.
create or replace function public.enforce_role_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Pin role only for end users (an 'authenticated' JWT via PostgREST). The
  -- service role and direct/admin SQL (no 'authenticated' claim, e.g. the
  -- Supabase SQL editor) may legitimately change roles.
  if new.role is distinct from old.role
     and auth.role() = 'authenticated' then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_immutable on public.profiles;
create trigger profiles_role_immutable
  before update on public.profiles
  for each row
  execute function public.enforce_role_immutable();

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
