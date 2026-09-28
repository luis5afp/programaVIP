-- Lower the userFLEX Client password minimum from 10 to 6 characters.
-- Hashing remains in PostgreSQL pgcrypto/bcrypt before credentials are stored.

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
    if char_length(v_password) < 6 or char_length(v_password) > 256 then
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

revoke all on function public.userflex_hash_client_password() from public, anon, authenticated;
