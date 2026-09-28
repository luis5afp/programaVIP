alter table public.userflex_profile_sessions add column if not exists material_ciphertext text;
alter table public.userflex_profile_sessions add column if not exists material_iv text;
alter table public.userflex_profile_sessions add column if not exists material_key_version text;
