-- Public read / service-role write bucket for userFLEX profile artwork.
-- Uploads are validated by the authenticated Cloudflare Worker before reaching Storage.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'userflex-profile-images',
  'userflex-profile-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
