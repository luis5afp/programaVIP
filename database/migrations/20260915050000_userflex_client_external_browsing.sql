alter table public.userflex_clients
  add column if not exists allow_external_browsing boolean not null default false;

comment on column public.userflex_clients.allow_external_browsing is
  'Allows the userFLOW client to offer an admin-controlled Google browsing tab inside isolated profile windows.';
