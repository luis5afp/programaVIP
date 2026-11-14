-- Per-client Edge extension UI permission. Existing and newly created clients
-- use restricted mode unless the userFLEX administrator grants full access.
ALTER TABLE public.userflex_clients
  ADD COLUMN IF NOT EXISTS browser_extensions_access text NOT NULL DEFAULT 'restricted';

ALTER TABLE public.userflex_clients
  ADD CONSTRAINT userflex_client_browser_extensions_access_check
  CHECK (browser_extensions_access IN ('restricted', 'full'));

COMMENT ON COLUMN public.userflex_clients.browser_extensions_access IS
  'restricted: managed app-style Edge window without extensions toolbar; full: normal Edge UI for authorized clients.';
