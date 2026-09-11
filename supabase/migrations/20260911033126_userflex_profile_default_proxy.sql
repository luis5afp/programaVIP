-- Optional default proxy per profile. Assignment-level proxy keeps precedence.
create table if not exists public.userflex_profile_proxy_defaults (
  profile_id uuid primary key references public.userflex_profiles(id) on delete cascade,
  proxy_id uuid not null references public.userflex_proxies(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists userflex_profile_proxy_defaults_proxy_id_idx
  on public.userflex_profile_proxy_defaults(proxy_id);

alter table public.userflex_profile_proxy_defaults enable row level security;
revoke all on table public.userflex_profile_proxy_defaults from anon, authenticated;
grant all on table public.userflex_profile_proxy_defaults to service_role;
