create table if not exists public.userflex_profile_credentials (
  profile_id uuid primary key references public.userflex_profiles(id) on delete cascade,
  login_username text not null,
  password_ciphertext text not null,
  password_iv text not null,
  key_version text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.userflex_profile_sessions (
  profile_id uuid primary key references public.userflex_profiles(id) on delete cascade,
  version bigint not null default 0,
  status text not null default 'empty' check (status in ('empty','active','needs_auth','expired')),
  material_ciphertext text,
  material_iv text,
  key_version text,
  public_ip text,
  captured_at timestamptz,
  validated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.userflex_profile_session_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','completed','expired')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists userflex_profile_session_jobs_profile_idx
  on public.userflex_profile_session_jobs(profile_id, created_at desc);
create index if not exists userflex_profile_session_jobs_expiry_idx
  on public.userflex_profile_session_jobs(expires_at);

alter table public.userflex_profile_credentials enable row level security;
alter table public.userflex_profile_sessions enable row level security;
alter table public.userflex_profile_session_jobs enable row level security;

revoke all on table public.userflex_profile_credentials from anon, authenticated;
revoke all on table public.userflex_profile_sessions from anon, authenticated;
revoke all on table public.userflex_profile_session_jobs from anon, authenticated;

grant all on table public.userflex_profile_credentials to service_role;
grant all on table public.userflex_profile_sessions to service_role;
grant all on table public.userflex_profile_session_jobs to service_role;
