create table if not exists public.userflex_plan_profiles (
  plan_id uuid not null references public.userflex_plans(id) on delete cascade,
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, profile_id)
);

create index if not exists userflex_plan_profiles_profile_id_idx
  on public.userflex_plan_profiles(profile_id);

-- Preserve existing behavior: profiles that already existed remain eligible for
-- plans that already existed until an administrator edits the plan allowlist.
insert into public.userflex_plan_profiles (plan_id, profile_id)
select p.id, f.id
from public.userflex_plans p
cross join public.userflex_profiles f
on conflict (plan_id, profile_id) do nothing;
