create table if not exists public.userflex_profile_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.userflex_clients(id) on delete set null,
  device_id uuid references public.userflex_devices(id) on delete set null,
  profile_id uuid references public.userflex_profiles(id) on delete set null,
  client_session_id uuid references public.userflex_client_sessions(id) on delete set null,
  client_name text not null,
  client_email text,
  device_name text,
  device_os text,
  profile_name text not null,
  profile_url text,
  client_version text,
  ip inet,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint userflex_profile_usage_close_order check (closed_at is null or closed_at >= opened_at)
);

create index if not exists userflex_profile_usage_opened_at_idx
  on public.userflex_profile_usage (opened_at desc);
create index if not exists userflex_profile_usage_client_opened_idx
  on public.userflex_profile_usage (client_id, opened_at desc);
create index if not exists userflex_profile_usage_device_opened_idx
  on public.userflex_profile_usage (device_id, opened_at desc);
create index if not exists userflex_profile_usage_profile_opened_idx
  on public.userflex_profile_usage (profile_id, opened_at desc);
create index if not exists userflex_profile_usage_open_sessions_idx
  on public.userflex_profile_usage (client_session_id)
  where closed_at is null;

alter table public.userflex_profile_usage enable row level security;
