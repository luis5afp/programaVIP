update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/octet-stream',
      'application/json'
    ]::text[]
where id = 'userflex-client-releases';
