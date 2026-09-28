insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'userflex-client-releases',
  'userflex-client-releases',
  true,
  157286400,
  array[
    'application/x-msdownload',
    'application/octet-stream',
    'application/yaml',
    'application/x-yaml',
    'text/yaml'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
