-- userFLEX production hardening.
-- Apply after 20260910_userflex_foundation.sql.

-- Validate the selected plan inside the same transaction that creates the client.
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

  if not exists (
    select 1
    from public.userflex_plans p
    where p.id = p_plan_id and p.enabled = true
  ) then
    raise exception 'USERFLEX_PLAN_INACTIVE';
  end if;

  insert into public.userflex_clients(name, email, phone, status)
  values (p_name, lower(p_email), nullif(p_phone, ''), 'active')
  returning id into v_client_id;

  insert into public.userflex_client_credentials(client_id, username, password_hash)
  values (v_client_id, lower(p_username), p_password_hash);

  insert into public.userflex_subscriptions(
    client_id,
    plan_id,
    starts_at,
    expires_at,
    status,
    offline_grace_minutes
  )
  values (v_client_id, p_plan_id, p_starts_at, p_expires_at, 'active', 0);

  return v_client_id;
end;
$$;

-- Replace a subscription atomically. If the new subscription cannot be created,
-- PostgreSQL rolls the cancellation of the previous one back automatically.
create or replace function public.userflex_replace_subscription(
  p_client_id uuid,
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription_id uuid;
begin
  if p_expires_at <= p_starts_at then
    raise exception 'INVALID_SUBSCRIPTION_RANGE';
  end if;

  perform 1
  from public.userflex_clients c
  where c.id = p_client_id
  for update;

  if not found then
    raise exception 'USERFLEX_CLIENT_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.userflex_plans p
    where p.id = p_plan_id and p.enabled = true
  ) then
    raise exception 'USERFLEX_PLAN_INACTIVE';
  end if;

  update public.userflex_subscriptions
  set status = 'cancelled',
      updated_at = now()
  where client_id = p_client_id
    and status = 'active';

  insert into public.userflex_subscriptions(
    client_id,
    plan_id,
    starts_at,
    expires_at,
    status,
    offline_grace_minutes
  )
  values (p_client_id, p_plan_id, p_starts_at, p_expires_at, 'active', 0)
  returning id into v_subscription_id;

  update public.userflex_client_sessions
  set revoked_at = coalesce(revoked_at, now())
  where client_id = p_client_id
    and revoked_at is null;

  return v_subscription_id;
end;
$$;

-- Reactivate a previously revoked device while enforcing the current plan limit.
create or replace function public.userflex_reactivate_device(p_device_id uuid)
returns table(id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.userflex_devices%rowtype;
  v_max_devices integer;
  v_active_count integer;
begin
  select *
  into v_device
  from public.userflex_devices d
  where d.id = p_device_id
  for update;

  if not found then
    return;
  end if;

  perform 1
  from public.userflex_clients c
  where c.id = v_device.client_id
  for update;

  select p.max_devices
  into v_max_devices
  from public.userflex_subscriptions s
  join public.userflex_plans p on p.id = s.plan_id
  where s.client_id = v_device.client_id
    and s.status = 'active'
    and s.starts_at <= now()
    and s.expires_at > now()
    and p.enabled = true
  order by s.expires_at desc
  limit 1;

  if v_max_devices is null then
    return query select v_device.id, 'subscription_inactive'::text;
    return;
  end if;

  select count(*)
  into v_active_count
  from public.userflex_devices d
  where d.client_id = v_device.client_id
    and d.status = 'active'
    and d.id <> v_device.id;

  if v_active_count >= v_max_devices then
    return query select v_device.id, 'limit_reached'::text;
    return;
  end if;

  update public.userflex_devices
  set status = 'active',
      updated_at = now()
  where userflex_devices.id = v_device.id;

  return query select v_device.id, 'active'::text;
end;
$$;

-- Cover userFLEX foreign keys used by joins and cascading lifecycle operations.
create index if not exists userflex_assignment_profile_idx
  on public.userflex_assignments(profile_id);
create index if not exists userflex_assignment_proxy_idx
  on public.userflex_assignments(proxy_id)
  where proxy_id is not null;
create index if not exists userflex_client_session_client_idx
  on public.userflex_client_sessions(client_id);
create index if not exists userflex_client_session_device_idx
  on public.userflex_client_sessions(device_id);
create index if not exists userflex_subscription_plan_idx
  on public.userflex_subscriptions(plan_id);

revoke all on function public.userflex_create_client(text,text,text,uuid,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.userflex_create_client(text,text,text,uuid,text,text,timestamptz,timestamptz)
  to service_role;

revoke all on function public.userflex_replace_subscription(uuid,uuid,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.userflex_replace_subscription(uuid,uuid,timestamptz,timestamptz)
  to service_role;

revoke all on function public.userflex_reactivate_device(uuid)
  from public, anon, authenticated;
grant execute on function public.userflex_reactivate_device(uuid)
  to service_role;
