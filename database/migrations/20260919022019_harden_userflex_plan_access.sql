alter table public.userflex_plan_profiles enable row level security;

revoke all on function public.userflex_disable_disallowed_assignments(uuid) from public, anon, authenticated;
revoke all on function public.userflex_enforce_assignment_plan_access() from public, anon, authenticated;
revoke all on function public.userflex_enforce_subscription_plan_access() from public, anon, authenticated;
revoke all on function public.userflex_plan_allows_profile(uuid, uuid) from public, anon, authenticated;

grant execute on function public.userflex_disable_disallowed_assignments(uuid) to service_role;
grant execute on function public.userflex_enforce_assignment_plan_access() to service_role;
grant execute on function public.userflex_enforce_subscription_plan_access() to service_role;
grant execute on function public.userflex_plan_allows_profile(uuid, uuid) to service_role;
