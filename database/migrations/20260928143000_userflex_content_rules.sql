-- Core managed content rules for userFLEX Browser Guard.
-- Rules are stored centrally in Neon and delivered only to profiles that should
-- receive them. The Browser Guard applies them locally without third-party
-- extension backends.

create table if not exists public.userflex_content_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null,
  selector text not null,
  action text not null default 'hide',
  scope text not null default 'selective',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint userflex_content_rules_action_check check (action in ('hide')),
  constraint userflex_content_rules_scope_check check (scope in ('global','selective')),
  constraint userflex_content_rules_name_check check (char_length(name) between 1 and 120),
  constraint userflex_content_rules_domain_check check (char_length(domain) between 1 and 255),
  constraint userflex_content_rules_selector_check check (char_length(selector) between 1 and 1000)
);

create index if not exists userflex_content_rules_enabled_idx
  on public.userflex_content_rules(enabled, scope);

create index if not exists userflex_content_rules_domain_idx
  on public.userflex_content_rules(lower(domain));

create table if not exists public.userflex_profile_content_rules (
  profile_id uuid not null references public.userflex_profiles(id) on delete cascade,
  rule_id uuid not null references public.userflex_content_rules(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, rule_id)
);

create index if not exists userflex_profile_content_rules_rule_idx
  on public.userflex_profile_content_rules(rule_id);

alter table public.userflex_content_rules enable row level security;
alter table public.userflex_profile_content_rules enable row level security;

comment on table public.userflex_content_rules is
  'Central Browser Guard rules managed by userFLEX Admin.';
comment on column public.userflex_content_rules.domain is
  'Hostname match. Exact host and subdomains are accepted; * applies to every HTTP(S) page.';
comment on column public.userflex_content_rules.selector is
  'CSS selector hidden by Browser Guard when the hostname matches.';
comment on column public.userflex_content_rules.scope is
  'global applies to every profile; selective uses userflex_profile_content_rules.';
