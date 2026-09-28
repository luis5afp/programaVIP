create or replace function public.userflex_plan_allows_profile(p_client_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select exists (
      select 1
      from public.userflex_plan_profiles pp
      where pp.plan_id = s.plan_id
        and pp.profile_id = p_profile_id
    )
    from public.userflex_subscriptions s
    where s.client_id = p_client_id
      and s.status = 'active'
    order by s.created_at desc
    limit 1
  ), false);
$$;

create or replace function public.userflex_disable_disallowed_assignments(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  update public.userflex_assignments a
  set enabled = false,
      updated_at = now()
  where a.enabled = true
    and exists (
      select 1
      from public.userflex_subscriptions s
      where s.client_id = a.client_id
        and s.plan_id = p_plan_id
        and s.status = 'active'
    )
    and not exists (
      select 1
      from public.userflex_plan_profiles pp
      where pp.plan_id = p_plan_id
        and pp.profile_id = a.profile_id
    );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.userflex_enforce_assignment_plan_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.enabled = true and not public.userflex_plan_allows_profile(new.client_id, new.profile_id) then
    raise exception 'PROFILE_NOT_ALLOWED_BY_PLAN' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists userflex_assignments_plan_access on public.userflex_assignments;
create trigger userflex_assignments_plan_access
before insert or update of client_id, profile_id, enabled
on public.userflex_assignments
for each row
execute function public.userflex_enforce_assignment_plan_access();

create or replace function public.userflex_enforce_subscription_plan_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    update public.userflex_assignments a
    set enabled = false,
        updated_at = now()
    where a.client_id = new.client_id
      and a.enabled = true
      and not exists (
        select 1
        from public.userflex_plan_profiles pp
        where pp.plan_id = new.plan_id
          and pp.profile_id = a.profile_id
      );
  end if;
  return new;
end;
$$;

drop trigger if exists userflex_subscriptions_plan_access on public.userflex_subscriptions;
create trigger userflex_subscriptions_plan_access
after insert or update of plan_id, status
on public.userflex_subscriptions
for each row
execute function public.userflex_enforce_subscription_plan_access();
