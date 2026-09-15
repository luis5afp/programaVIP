-- Move the effective device limit from plans to individual clients.
-- Keep userflex_plans.max_devices for backwards compatibility only.

alter table public.userflex_clients
  add column if not exists max_devices integer;

update public.userflex_clients c
set max_devices = coalesce((
  select p.max_devices
  from public.userflex_subscriptions s
  join public.userflex_plans p on p.id = s.plan_id
  where s.client_id = c.id
  order by (s.status = 'active') desc, s.created_at desc
  limit 1
), 1)
where c.max_devices is null;

alter table public.userflex_clients
  alter column max_devices set default 1,
  alter column max_devices set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'userflex_clients_max_devices_check'
      and conrelid = 'public.userflex_clients'::regclass
  ) then
    alter table public.userflex_clients
      add constraint userflex_clients_max_devices_check
      check (max_devices between 1 and 50);
  end if;
end $$;

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
  select * into v_device
  from public.userflex_devices d
  where d.id = p_device_id
  for update;

  if not found then return; end if;

  select c.max_devices into v_max_devices
  from public.userflex_clients c
  where c.id = v_device.client_id
  for update;

  if v_max_devices is null then return; end if;

  if not exists (
    select 1
    from public.userflex_subscriptions s
    join public.userflex_plans p on p.id = s.plan_id
    where s.client_id = v_device.client_id
      and s.status = 'active'
      and s.starts_at <= now()
      and s.expires_at > now()
      and p.enabled = true
  ) then
    return query select v_device.id, 'subscription_inactive'::text;
    return;
  end if;

  select count(*) into v_active_count
  from public.userflex_devices d
  where d.client_id = v_device.client_id
    and d.status = 'active'
    and d.id <> v_device.id;

  if v_active_count >= v_max_devices then
    return query select v_device.id, 'limit_reached'::text;
    return;
  end if;

  update public.userflex_devices
  set status = 'active', updated_at = now()
  where userflex_devices.id = v_device.id;

  return query select v_device.id, 'active'::text;
end;
$$;
