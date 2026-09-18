-- Authoritative operator preference, separate from the replenishment forecast.
create table public.analytics_settings (
  marketplace_id text primary key default 'ATVPDKIKX0DER',
  exclude_vine boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.analytics_settings is
  'Operational analytics preferences. Does not change inventory or replenishment forecasts.';

alter table public.analytics_settings enable row level security;
revoke all on public.analytics_settings from public, anon, authenticated;
grant select, insert, update on public.analytics_settings to authenticated;

create policy analytics_settings_read on public.analytics_settings
  for select to authenticated using (true);
create policy analytics_settings_insert on public.analytics_settings
  for insert to authenticated with check (true);
create policy analytics_settings_update on public.analytics_settings
  for update to authenticated using (true) with check (true);

-- Derive audit metadata from the authenticated session, never browser input.
create function public.stamp_analytics_settings() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger analytics_settings_audit
  before insert or update on public.analytics_settings
  for each row execute function public.stamp_analytics_settings();

insert into public.analytics_settings (marketplace_id, exclude_vine)
values ('ATVPDKIKX0DER', false);
