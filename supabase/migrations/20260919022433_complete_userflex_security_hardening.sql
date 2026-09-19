revoke all on table public.userflex_plan_profiles from anon, authenticated;
grant all on table public.userflex_plan_profiles to service_role;

revoke all on table public.userflex_profile_usage from anon, authenticated;
grant all on table public.userflex_profile_usage to service_role;

alter table public.userflex_client_credentials
  drop constraint if exists userflex_client_credentials_password_hash_format_check;

alter table public.userflex_client_credentials
  add constraint userflex_client_credentials_password_hash_format_check
  check (
    password_hash ~ '^\$2[aby]\$'
    or password_hash like 'pbkdf2-sha256$%'
  );
