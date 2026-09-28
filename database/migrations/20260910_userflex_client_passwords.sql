-- Move Client password hashing/verification out of Cloudflare CPU and into PostgreSQL pgcrypto.
-- The Worker sends a short-lived explicit transport envelope over TLS; this trigger
-- converts it to bcrypt before the row is stored. Existing PBKDF2 hashes remain valid.

create or replace function public.userflex_hash_client_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_prefix constant text := 'uf-plain-v1$';
  v_password text;
begin
  if new.password_hash like v_prefix || '%' then
    v_password := substr(new.password_hash, length(v_prefix) + 1);
    if char_length(v_password) < 10 or char_length(v_password) > 256 then
      raise exception 'USERFLEX_WEAK_PASSWORD';
    end if;
    new.password_hash := extensions.crypt(v_password, extensions.gen_salt('bf', 12));
  elsif new.password_hash like 'pbkdf2-sha256$%' or new.password_hash ~ '^\$2[aby]\$' then
    null;
  else
    raise exception 'USERFLEX_INVALID_PASSWORD_HASH';
  end if;
  return new;
end;
$$;

drop trigger if exists userflex_client_credentials_hash_password on public.userflex_client_credentials;
create trigger userflex_client_credentials_hash_password
before insert or update of password_hash on public.userflex_client_credentials
for each row execute function public.userflex_hash_client_password();

create or replace function public.userflex_verify_client_password(
  p_client_id uuid,
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
  from public.userflex_client_credentials
  where client_id = p_client_id;

  if v_hash is null then
    return false;
  end if;

  if v_hash ~ '^\$2[aby]\$' then
    return extensions.crypt(p_password, v_hash) = v_hash;
  end if;

  return false;
end;
$$;

revoke all on function public.userflex_hash_client_password() from public, anon, authenticated;
revoke all on function public.userflex_verify_client_password(uuid,text) from public, anon, authenticated;
grant execute on function public.userflex_verify_client_password(uuid,text) to service_role;
