-- Managed Chrome extensions for userFLEX profiles.
-- Packages are uploaded through the authenticated Worker, validated server-side,
-- stored privately in Supabase Storage, and only delivered to authorized userFLOW clients.

create table if not exists public.userflex_extensions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  version text not null,
  manifest jsonb not null default '{}'::jsonb,
  permissions jsonb not null default '[]'::jsonb,
  package_path text not null,
  package_sha256 text not null,
  package_size bigint not null,
  scope text not null default 'selective',
  enabled boolean not null default false,
  validation_status text not null default 'package_valid',
  validation_message text,
  runtime_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint userflex_extensions_scope_check check (scope in ('global','selective')),
  constraint userflex_extensions_validation_check check (validation_status in ('package_valid','runtime_valid','error','incompatible')),
  constraint userflex_extensions_sha256_check check (package_sha256 ~ '^[a-f0-9]{64}$'),
  constraint userflex_extensions_size_check check (package_size > 0 and package_size <= 20971520)
);

create unique index if not exists userflex_extensions_name_lower_uidx
  on public.userflex_extensions (lower(name));

create table if not exists public.userflex_profile_extensions (
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  extension_id uuid not null references public.userflex_extensions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, extension_id)
);

create index if not exists userflex_profile_extensions_extension_idx
  on public.userflex_profile_extensions(extension_id);

create table if not exists public.userflex_extension_validation_jobs (
  id uuid primary key default gen_random_uuid(),
  extension_id uuid not null references public.userflex_extensions(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending',
  result jsonb,
  error text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint userflex_extension_validation_status_check check (status in ('pending','running','pass','fail','expired'))
);

create index if not exists userflex_extension_validation_jobs_extension_idx
  on public.userflex_extension_validation_jobs(extension_id, created_at desc);

alter table public.userflex_extensions enable row level security;
alter table public.userflex_profile_extensions enable row level security;
alter table public.userflex_extension_validation_jobs enable row level security;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'userflex-extension-packages',
  'userflex-extension-packages',
  false,
  20971520,
  array['application/zip','application/x-zip-compressed','application/octet-stream']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.userflex_extensions is
  'Admin-managed Chrome extension packages available to userFLOW.';
comment on column public.userflex_extensions.scope is
  'global applies to all profiles; selective uses userflex_profile_extensions.';
comment on column public.userflex_extensions.validation_status is
  'package_valid after static package validation; runtime_valid after a real userFLOW Chrome load test.';
