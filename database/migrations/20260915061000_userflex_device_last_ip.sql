alter table public.userflex_devices
  add column if not exists last_ip inet;

comment on column public.userflex_devices.last_ip is
  'Latest public source IP observed by the Cloudflare Worker for this device.';
