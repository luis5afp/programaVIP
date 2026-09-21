begin;

create table if not exists public.userflex_session_keepers (
  profile_id uuid primary key references public.userflex_profiles(id) on delete cascade,
  token_hash text not null unique,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  last_check_at timestamptz,
  last_refresh_at timestamptz,
  last_status text not null default 'registered',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint userflex_session_keepers_status_check
    check (last_status in ('registered','healthy','refreshing','needs_admin','error','disabled'))
);

create table if not exists public.userflex_profile_session_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  session_version bigint not null,
  material_ciphertext text not null,
  material_iv text not null,
  material_key_version text,
  expected_egress_ip inet,
  captured_at timestamptz,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(profile_id, session_version)
);

create index if not exists userflex_session_versions_profile_created_idx
  on public.userflex_profile_session_versions(profile_id, created_at desc);

alter table public.userflex_session_keepers enable row level security;
alter table public.userflex_profile_session_versions enable row level security;

commit;
