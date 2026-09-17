create table if not exists public.sync_refresh_locks (
  source text primary key,
  owner_token uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > acquired_at)
);

alter table public.sync_refresh_locks enable row level security;

revoke all on table public.sync_refresh_locks from public, anon, authenticated;

create or replace function public.acquire_sync_refresh_lock(
  p_source text,
  p_owner_token uuid,
  p_ttl_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source is null or btrim(p_source) = '' then
    raise exception 'sync refresh lock source is required';
  end if;
  if p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'sync refresh lock TTL must be between 1 and 3600 seconds';
  end if;

  insert into public.sync_refresh_locks (
    source,
    owner_token,
    acquired_at,
    expires_at
  )
  values (
    p_source,
    p_owner_token,
    now(),
    now() + make_interval(secs => p_ttl_seconds)
  )
  on conflict (source) do update
    set owner_token = excluded.owner_token,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where public.sync_refresh_locks.expires_at <= now();

  return found;
end;
$$;

create or replace function public.release_sync_refresh_lock(
  p_source text,
  p_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sync_refresh_locks
  where source = p_source
    and owner_token = p_owner_token;

  return found;
end;
$$;

revoke all on function public.acquire_sync_refresh_lock(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_sync_refresh_lock(text, uuid)
  from public, anon, authenticated;

grant execute on function public.acquire_sync_refresh_lock(text, uuid, integer)
  to service_role;
grant execute on function public.release_sync_refresh_lock(text, uuid)
  to service_role;

comment on table public.sync_refresh_locks is
  'Short-lived service-role leases that serialize manual mirror refreshes across server instances.';
