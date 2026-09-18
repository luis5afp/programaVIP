create table if not exists public.userflex_profile_validation_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  client_id uuid references public.userflex_clients(id) on delete set null,
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending','running','completed','failed','expired')),
  result jsonb,
  error text,
  expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists userflex_profile_validation_jobs_profile_idx
  on public.userflex_profile_validation_jobs(profile_id, created_at desc);
create index if not exists userflex_profile_validation_jobs_expiry_idx
  on public.userflex_profile_validation_jobs(expires_at);

alter table public.userflex_profile_validation_jobs enable row level security;
revoke all on table public.userflex_profile_validation_jobs from anon, authenticated;
grant all on table public.userflex_profile_validation_jobs to service_role;
