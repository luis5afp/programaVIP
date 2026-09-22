alter table public.userflex_devices
  add column if not exists userflow_version text,
  add column if not exists userflow_version_seen_at timestamptz;

alter table public.userflex_session_keepers
  add column if not exists session_manager_version text,
  add column if not exists session_manager_version_seen_at timestamptz;

alter table public.userflex_profile_session_jobs
  add column if not exists session_manager_version text;

create index if not exists idx_userflex_devices_userflow_version
  on public.userflex_devices (userflow_version);

create index if not exists idx_userflex_session_keepers_session_manager_version
  on public.userflex_session_keepers (session_manager_version);
