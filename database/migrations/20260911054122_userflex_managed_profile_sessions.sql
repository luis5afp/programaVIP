create table if not exists public.userflex_profile_sessions (
  profile_id uuid primary key references public.userflex_profiles(id) on delete cascade,
  login_identifier_ciphertext text,
  login_identifier_iv text,
  login_password_ciphertext text,
  login_password_iv text,
  key_version text,
  status text not null default 'unconfigured' check (status in ('unconfigured','ready','needs_auth','expired')),
  session_version bigint not null default 0 check (session_version >= 0),
  expected_egress_ip inet,
  last_captured_at timestamptz,
  last_validated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.userflex_profile_session_snapshots (
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  version bigint not null,
  format_version integer not null default 1,
  payload_ciphertext text not null,
  payload_iv text not null,
  payload_sha256 text not null,
  key_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, version)
);

alter table public.userflex_profile_sessions enable row level security;
alter table public.userflex_profile_session_snapshots enable row level security;
revoke all on table public.userflex_profile_sessions from anon, authenticated;
revoke all on table public.userflex_profile_session_snapshots from anon, authenticated;
grant all on table public.userflex_profile_sessions to service_role;
grant all on table public.userflex_profile_session_snapshots to service_role;
