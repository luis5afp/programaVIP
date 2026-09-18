alter table public.userflex_plan_profiles enable row level security;

revoke all on table public.userflex_plan_profiles from anon, authenticated;
grant all on table public.userflex_plan_profiles to service_role;

revoke execute on function public.userflex_disable_disallowed_assignments(uuid)
  from public, anon, authenticated;
revoke execute on function public.userflex_enforce_assignment_plan_access()
  from public, anon, authenticated;
revoke execute on function public.userflex_enforce_subscription_plan_access()
  from public, anon, authenticated;
revoke execute on function public.userflex_plan_allows_profile(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.userflex_disable_disallowed_assignments(uuid) to service_role;
grant execute on function public.userflex_enforce_assignment_plan_access() to service_role;
grant execute on function public.userflex_enforce_subscription_plan_access() to service_role;
grant execute on function public.userflex_plan_allows_profile(uuid, uuid) to service_role;

-- userFLEX accesses runtime/audit data exclusively through the Worker service role.
revoke all on table public.userflex_profile_usage from anon, authenticated;
grant all on table public.userflex_profile_usage to service_role;

-- Only formats understood by verifyClientPassword may be stored. This makes
-- accidental plaintext or an unsupported hash format fail closed at the DB.
alter table public.userflex_client_credentials
  drop constraint if exists userflex_client_credentials_password_hash_format_check;

alter table public.userflex_client_credentials
  add constraint userflex_client_credentials_password_hash_format_check
  check (
    password_hash ~ '^\\$2[aby]\\$'
    or password_hash like 'pbkdf2-sha256$%'
  );
