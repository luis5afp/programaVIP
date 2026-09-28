-- Allow administrator passwords with a minimum of 6 characters.

create or replace function public.userflex_create_admin_user(
  p_username text,
  p_password text,
  p_display_name text,
  p_email text,
  p_role text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_username text := btrim(coalesce(p_username, ''));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if char_length(v_username) < 3 or char_length(v_username) > 120 then
    raise exception 'USERFLEX_ADMIN_INVALID_USERNAME';
  end if;
  if char_length(v_display_name) < 2 or char_length(v_display_name) > 120 then
    raise exception 'USERFLEX_ADMIN_INVALID_NAME';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 256 then
    raise exception 'USERFLEX_ADMIN_WEAK_PASSWORD';
  end if;
  if p_role not in ('owner', 'admin') then
    raise exception 'USERFLEX_ADMIN_INVALID_ROLE';
  end if;
  if v_email is not null and (char_length(v_email) > 180 or position('@' in v_email) < 2) then
    raise exception 'USERFLEX_ADMIN_INVALID_EMAIL';
  end if;

  insert into public.vsixteen_users (username, password_hash, enabled, updated_at)
  values (v_username, extensions.crypt(p_password, extensions.gen_salt('bf', 12)), true, now())
  returning id into v_user_id;

  insert into public.userflex_admin_profiles (
    user_id, display_name, email, role, created_by, created_at, updated_at
  ) values (
    v_user_id, v_display_name, v_email, p_role, p_created_by, now(), now()
  );

  return v_user_id;
end;
$$;

create or replace function public.userflex_set_admin_password(
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 256 then
    raise exception 'USERFLEX_ADMIN_WEAK_PASSWORD';
  end if;

  update public.vsixteen_users
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'USERFLEX_ADMIN_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.userflex_create_admin_user(text,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.userflex_set_admin_password(uuid,text) from public, anon, authenticated;
grant execute on function public.userflex_create_admin_user(text,text,text,text,text,uuid) to service_role;
grant execute on function public.userflex_set_admin_password(uuid,text) to service_role;
