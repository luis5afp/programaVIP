-- Administrator management for userFLEX Admin.
-- Keeps the existing vsixteen_users / vsixteen_login_sessions credential/session layer
-- for seamless migration while adding explicit userFLEX roles and metadata.

create table if not exists public.userflex_admin_profiles (
  user_id uuid primary key references public.vsixteen_users(id) on delete cascade,
  display_name text not null,
  email text null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  last_login_at timestamptz null,
  created_by uuid null references public.vsixteen_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists userflex_admin_profiles_email_unique
on public.userflex_admin_profiles (lower(email))
where email is not null;

alter table public.userflex_admin_profiles enable row level security;

create or replace function public.userflex_verify_admin_password(
  p_user_id uuid,
  p_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
begin
  if p_password is null or char_length(p_password) < 1 or char_length(p_password) > 256 then
    return false;
  end if;

  select password_hash into v_hash
  from public.vsixteen_users
  where id = p_user_id and enabled = true;

  if v_hash is null or v_hash !~ '^\$2[aby]\$' then
    return false;
  end if;

  return extensions.crypt(p_password, v_hash) = v_hash;
end;
$$;

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
  if p_password is null or char_length(p_password) < 10 or char_length(p_password) > 256 then
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
  if p_password is null or char_length(p_password) < 10 or char_length(p_password) > 256 then
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

revoke all on table public.userflex_admin_profiles from public, anon, authenticated;
revoke all on function public.userflex_verify_admin_password(uuid,text) from public, anon, authenticated;
revoke all on function public.userflex_create_admin_user(text,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.userflex_set_admin_password(uuid,text) from public, anon, authenticated;

grant execute on function public.userflex_verify_admin_password(uuid,text) to service_role;
grant execute on function public.userflex_create_admin_user(text,text,text,text,text,uuid) to service_role;
grant execute on function public.userflex_set_admin_password(uuid,text) to service_role;
