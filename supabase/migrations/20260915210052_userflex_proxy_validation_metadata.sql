alter table public.userflex_proxies
  add column if not exists proxy_type text not null default 'unknown',
  add column if not exists validation_status text not null default 'pending',
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_latency_ms integer,
  add column if not exists public_ip inet,
  add column if not exists country_code text,
  add column if not exists country text,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists timezone text,
  add column if not exists validation_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.userflex_proxies'::regclass
      and conname = 'userflex_proxies_proxy_type_check'
  ) then
    alter table public.userflex_proxies
      add constraint userflex_proxies_proxy_type_check
      check (proxy_type in ('unknown','http','https','socks4','socks5','ssh'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.userflex_proxies'::regclass
      and conname = 'userflex_proxies_validation_status_check'
  ) then
    alter table public.userflex_proxies
      add constraint userflex_proxies_validation_status_check
      check (validation_status in ('pending','valid','reachable','invalid','unverifiable'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.userflex_proxies'::regclass
      and conname = 'userflex_proxies_last_latency_ms_check'
  ) then
    alter table public.userflex_proxies
      add constraint userflex_proxies_last_latency_ms_check
      check (last_latency_ms is null or last_latency_ms >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.userflex_proxies'::regclass
      and conname = 'userflex_proxies_country_code_check'
  ) then
    alter table public.userflex_proxies
      add constraint userflex_proxies_country_code_check
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

comment on column public.userflex_proxies.proxy_type is 'Protocol detected by the userFLEX proxy validator.';
comment on column public.userflex_proxies.validation_status is 'Latest proxy validation result performed by the Cloudflare Worker.';
comment on column public.userflex_proxies.public_ip is 'Observed egress IP when the proxy successfully relays traffic.';
comment on column public.userflex_proxies.validation_error is 'Sanitized latest validation failure; never contains credentials.';
