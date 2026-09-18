-- Multi-strategy profile runtime inspired by the observed KAIZEN profile model.
-- Existing profiles keep their legacy behavior through compatibility defaults.

alter table public.userflex_profiles
  add column if not exists browser_engine text not null default 'chrome-native',
  add column if not exists auth_strategy text not null default 'manual',
  add column if not exists storage_strategy text not null default 'local-persistent',
  add column if not exists network_strategy text not null default 'auto',
  add column if not exists extension_strategy text not null default 'guard-only';

alter table public.userflex_profiles drop constraint if exists userflex_profiles_browser_engine_check;
alter table public.userflex_profiles add constraint userflex_profiles_browser_engine_check
  check (browser_engine in ('chrome-native','nstchrome'));

alter table public.userflex_profiles drop constraint if exists userflex_profiles_auth_strategy_check;
alter table public.userflex_profiles add constraint userflex_profiles_auth_strategy_check
  check (auth_strategy in ('manual','cookie-snapshot','credential-autofill','hybrid'));

alter table public.userflex_profiles drop constraint if exists userflex_profiles_storage_strategy_check;
alter table public.userflex_profiles add constraint userflex_profiles_storage_strategy_check
  check (storage_strategy in ('local-persistent','cookies-only','portable-first-party','netflix-local-device'));

alter table public.userflex_profiles drop constraint if exists userflex_profiles_network_strategy_check;
alter table public.userflex_profiles add constraint userflex_profiles_network_strategy_check
  check (network_strategy in ('auto','client-direct','profile-proxy','assigned-proxy'));

alter table public.userflex_profiles drop constraint if exists userflex_profiles_extension_strategy_check;
alter table public.userflex_profiles add constraint userflex_profiles_extension_strategy_check
  check (extension_strategy in ('guard-only','main','google','custom'));

-- Preserve the behavior of profiles that existed before this migration.
update public.userflex_profiles
set
  auth_strategy = case
    when session_mode = 'managed-first-party' then 'cookie-snapshot'
    else 'manual'
  end,
  storage_strategy = case
    when session_mode = 'managed-first-party' and lower(url) like '%netflix.com%' then 'netflix-local-device'
    when session_mode = 'managed-first-party' then 'portable-first-party'
    else 'local-persistent'
  end,
  network_strategy = 'auto',
  extension_strategy = case
    when session_mode = 'managed-first-party' then 'custom'
    else 'guard-only'
  end
where auth_strategy = 'manual'
  and storage_strategy = 'local-persistent'
  and network_strategy = 'auto'
  and extension_strategy = 'guard-only';

comment on column public.userflex_profiles.browser_engine is
  'Browser runtime family used by userFLOW: chrome-native or nstchrome.';
comment on column public.userflex_profiles.auth_strategy is
  'Authentication strategy: manual, cookie snapshot, credential autofill, or hybrid.';
comment on column public.userflex_profiles.storage_strategy is
  'How first-party browser state is restored and persisted.';
comment on column public.userflex_profiles.network_strategy is
  'Network egress policy for the profile. Explicit proxy modes fail closed.';
comment on column public.userflex_profiles.extension_strategy is
  'userFLOW extension behavior family corresponding to the profile policy.';
