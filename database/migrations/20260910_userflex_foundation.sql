-- userFLEX Admin / Client foundation for Supabase project CREATORTOOLS LAB.
-- This migration deliberately reuses the existing vsixteen_users and
-- vsixteen_login_sessions tables for administrator authentication.

create table if not exists public.userflex_plans (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check (char_length(name) between 1 and 80),
  duration_days integer check (duration_days is null or duration_days between 1 and 3650),
  max_devices integer not null default 1 check (max_devices between 1 and 50),
  max_profiles integer not null default 5 check (max_profiles between 1 and 500),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.userflex_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text unique not null,
  phone text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.userflex_client_credentials (
  client_id uuid primary key references public.userflex_clients(id) on delete cascade,
  username text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.userflex_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.userflex_clients(id) on delete cascade,
  plan_id uuid not null references public.userflex_plans(id) on delete restrict,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'cancelled')),
  offline_grace_minutes integer not null default 0 check (offline_grace_minutes between 0 and 10080),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint userflex_subscription_range check (expires_at > starts_at)
);

create unique index if not exists userflex_one_active_subscription_per_client
  on public.userflex_subscriptions(client_id)
  where status = 'active';

create table if not exists public.userflex_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  url text not null check (url ~ '^https://'),
  platform text,
  image_url text check (image_url is null or image_url ~ '^https://'),
  tags text[] not null default '{}'::text[],
  enabled boolean not null default true,
  session_mode text not null default 'manual-login' check (session_mode in ('manual-login', 'managed-first-party')),
  session_ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.userflex_proxies (
  id uuid primary key default gen_random_uuid(),
  name text unique not null check (char_length(name) between 1 and 100),
  host text not null,
  port integer not null check (port between 1 and 65535),
  username text,
  password_ciphertext text,
  password_iv text,
  key_version text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint userflex_proxy_secret_consistency check (
    (password_ciphertext is null and password_iv is null and key_version is null)
    or
    (password_ciphertext is not null and password_iv is not null and key_version is not null)
  )
);

create table if not exists public.userflex_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.userflex_clients(id) on delete cascade,
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  proxy_id uuid references public.userflex_proxies(id) on delete set null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, profile_id)
);

create table if not exists public.userflex_devices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.userflex_clients(id) on delete cascade,
  device_hash text not null,
  name text not null,
  os text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, device_hash)
);

create table if not exists public.userflex_client_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.userflex_clients(id) on delete cascade,
  device_id uuid not null references public.userflex_devices(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  constraint userflex_client_session_expiry check (expires_at > created_at)
);

create table if not exists public.userflex_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('admin', 'client', 'system')),
  actor_id text,
  action text not null,
  entity_type text,
  entity_id text,
  ip_hash text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint userflex_audit_details_object check (jsonb_typeof(details) = 'object')
);

create table if not exists public.userflex_login_guards (
  ip_hash text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists userflex_subscription_client_idx on public.userflex_subscriptions(client_id, expires_at desc);
create index if not exists userflex_assignment_client_idx on public.userflex_assignments(client_id) where enabled = true;
create index if not exists userflex_device_client_idx on public.userflex_devices(client_id, status);
create index if not exists userflex_client_session_active_idx on public.userflex_client_sessions(token_hash, expires_at) where revoked_at is null;
create index if not exists userflex_audit_created_idx on public.userflex_audit_logs(created_at desc);

-- Atomic creation avoids partially-created clients when a later step fails.
create or replace function public.userflex_create_client(
  p_name text,
  p_email text,
  p_phone text,
  p_plan_id uuid,
  p_username text,
  p_password_hash text,
  p_starts_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
begin
  if p_expires_at <= p_starts_at then
    raise exception 'INVALID_SUBSCRIPTION_RANGE';
  end if;

  insert into public.userflex_clients(name, email, phone, status)
  values (p_name, lower(p_email), nullif(p_phone, ''), 'active')
  returning id into v_client_id;

  insert into public.userflex_client_credentials(client_id, username, password_hash)
  values (v_client_id, lower(p_username), p_password_hash);

  insert into public.userflex_subscriptions(client_id, plan_id, starts_at, expires_at, status, offline_grace_minutes)
  values (v_client_id, p_plan_id, p_starts_at, p_expires_at, 'active', 0);

  return v_client_id;
end;
$$;

-- Atomic device registration prevents concurrent logins from exceeding plan limits.
create or replace function public.userflex_register_device(
  p_client_id uuid,
  p_device_hash text,
  p_name text,
  p_os text,
  p_max_devices integer
)
returns table(id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.userflex_devices%rowtype;
  v_count integer;
  v_id uuid;
begin
  perform 1 from public.userflex_clients where userflex_clients.id = p_client_id for update;

  select * into v_existing
  from public.userflex_devices d
  where d.client_id = p_client_id and d.device_hash = p_device_hash
  for update;

  if found then
    if v_existing.status = 'revoked' then
      return query select v_existing.id, 'revoked'::text;
      return;
    end if;
    update public.userflex_devices
       set name = p_name, os = p_os, last_seen_at = now(), updated_at = now()
     where userflex_devices.id = v_existing.id;
    return query select v_existing.id, 'active'::text;
    return;
  end if;

  select count(*) into v_count
  from public.userflex_devices d
  where d.client_id = p_client_id and d.status = 'active';

  if v_count >= p_max_devices then
    return query select null::uuid, 'limit_reached'::text;
    return;
  end if;

  insert into public.userflex_devices(client_id, device_hash, name, os, status, last_seen_at)
  values (p_client_id, p_device_hash, p_name, p_os, 'active', now())
  returning userflex_devices.id into v_id;

  return query select v_id, 'active'::text;
end;
$$;

-- Assignment writes are serialized per client and enforce the active plan's profile limit.
create or replace function public.userflex_upsert_assignment(
  p_client_id uuid,
  p_profile_id uuid,
  p_proxy_id uuid,
  p_enabled boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_profiles integer;
  v_count integer;
  v_id uuid;
begin
  perform 1 from public.userflex_clients where userflex_clients.id = p_client_id for update;

  if p_enabled then
    select p.max_profiles into v_max_profiles
    from public.userflex_subscriptions s
    join public.userflex_plans p on p.id = s.plan_id
    where s.client_id = p_client_id
      and s.status = 'active'
      and s.starts_at <= now()
      and s.expires_at > now()
      and p.enabled = true
    order by s.expires_at desc
    limit 1;

    if v_max_profiles is null then
      raise exception 'USERFLEX_SUBSCRIPTION_INACTIVE';
    end if;

    select count(*) into v_count
    from public.userflex_assignments a
    where a.client_id = p_client_id
      and a.enabled = true
      and a.profile_id <> p_profile_id;

    if v_count >= v_max_profiles then
      raise exception 'USERFLEX_PROFILE_LIMIT_REACHED';
    end if;
  end if;

  insert into public.userflex_assignments(client_id, profile_id, proxy_id, enabled)
  values (p_client_id, p_profile_id, p_proxy_id, p_enabled)
  on conflict (client_id, profile_id) do update
    set proxy_id = excluded.proxy_id,
        enabled = excluded.enabled,
        updated_at = now()
  returning userflex_assignments.id into v_id;

  return v_id;
end;
$$;

-- Six attempts per 15-minute window. Once blocked, the key must wait 15 minutes.
create or replace function public.userflex_login_guard(p_ip_hash text)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.userflex_login_guards%rowtype;
  v_now timestamptz := now();
begin
  insert into public.userflex_login_guards(ip_hash, attempt_count, window_started_at, blocked_until, updated_at)
  values (p_ip_hash, 0, v_now, null, v_now)
  on conflict (ip_hash) do nothing;

  select * into v_row
  from public.userflex_login_guards
  where ip_hash = p_ip_hash
  for update;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  if v_row.window_started_at < v_now - interval '15 minutes' then
    update public.userflex_login_guards
       set attempt_count = 1, window_started_at = v_now, blocked_until = null, updated_at = v_now
     where ip_hash = p_ip_hash;
    return query select true, 0;
    return;
  end if;

  if v_row.attempt_count + 1 >= 6 then
    update public.userflex_login_guards
       set attempt_count = v_row.attempt_count + 1,
           blocked_until = v_now + interval '15 minutes',
           updated_at = v_now
     where ip_hash = p_ip_hash;
    return query select false, 900;
    return;
  end if;

  update public.userflex_login_guards
     set attempt_count = v_row.attempt_count + 1, updated_at = v_now
   where ip_hash = p_ip_hash;
  return query select true, 0;
end;
$$;

create or replace function public.userflex_login_guard_reset(p_ip_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.userflex_login_guards where ip_hash = p_ip_hash;
$$;

-- No direct browser/database access. Cloudflare's service role is the authority.
alter table public.userflex_plans enable row level security;
alter table public.userflex_clients enable row level security;
alter table public.userflex_client_credentials enable row level security;
alter table public.userflex_subscriptions enable row level security;
alter table public.userflex_profiles enable row level security;
alter table public.userflex_proxies enable row level security;
alter table public.userflex_assignments enable row level security;
alter table public.userflex_devices enable row level security;
alter table public.userflex_client_sessions enable row level security;
alter table public.userflex_audit_logs enable row level security;
alter table public.userflex_login_guards enable row level security;

revoke all on table public.userflex_plans from anon, authenticated;
revoke all on table public.userflex_clients from anon, authenticated;
revoke all on table public.userflex_client_credentials from anon, authenticated;
revoke all on table public.userflex_subscriptions from anon, authenticated;
revoke all on table public.userflex_profiles from anon, authenticated;
revoke all on table public.userflex_proxies from anon, authenticated;
revoke all on table public.userflex_assignments from anon, authenticated;
revoke all on table public.userflex_devices from anon, authenticated;
revoke all on table public.userflex_client_sessions from anon, authenticated;
revoke all on table public.userflex_audit_logs from anon, authenticated;
revoke all on table public.userflex_login_guards from anon, authenticated;

grant all on table public.userflex_plans to service_role;
grant all on table public.userflex_clients to service_role;
grant all on table public.userflex_client_credentials to service_role;
grant all on table public.userflex_subscriptions to service_role;
grant all on table public.userflex_profiles to service_role;
grant all on table public.userflex_proxies to service_role;
grant all on table public.userflex_assignments to service_role;
grant all on table public.userflex_devices to service_role;
grant all on table public.userflex_client_sessions to service_role;
grant all on table public.userflex_audit_logs to service_role;
grant all on table public.userflex_login_guards to service_role;

revoke all on function public.userflex_create_client(text,text,text,uuid,text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.userflex_create_client(text,text,text,uuid,text,text,timestamptz,timestamptz) to service_role;
revoke all on function public.userflex_register_device(uuid,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.userflex_register_device(uuid,text,text,text,integer) to service_role;
revoke all on function public.userflex_upsert_assignment(uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.userflex_upsert_assignment(uuid,uuid,uuid,boolean) to service_role;
revoke all on function public.userflex_login_guard(text) from public, anon, authenticated;
grant execute on function public.userflex_login_guard(text) to service_role;
revoke all on function public.userflex_login_guard_reset(text) from public, anon, authenticated;
grant execute on function public.userflex_login_guard_reset(text) to service_role;
