ALTER TABLE public.upstream_tokens RENAME TO upstream_grants;

-- The access token was persisted. It is deleted outright, not migrated: no
-- durable location may hold one.
ALTER TABLE public.upstream_grants DROP COLUMN encrypted_access;
ALTER TABLE public.upstream_grants RENAME COLUMN encrypted_refresh TO sealed_grant;
ALTER TABLE public.upstream_grants DROP COLUMN token_type;

ALTER TABLE public.upstream_grants ADD COLUMN grant_kind text NOT NULL DEFAULT 'refresh';
ALTER TABLE public.upstream_grants ADD COLUMN key_ref text;
ALTER TABLE public.upstream_grants
  ADD CONSTRAINT upstream_grants_kind_check
  CHECK (grant_kind IN ('workload','mtls','assertion','refresh'));

-- Rows with no durable authority left are useless; drop them so a caller gets
-- an honest "reconnect" rather than a silent failure.
DELETE FROM public.upstream_grants WHERE grant_kind = 'refresh' AND sealed_grant IS NULL;

ALTER TABLE public.upstream_oauth ADD COLUMN IF NOT EXISTS grant_kind text NOT NULL DEFAULT 'refresh';
ALTER TABLE public.upstream_oauth ADD COLUMN IF NOT EXISTS key_ref text;
ALTER TABLE public.upstream_oauth ADD COLUMN IF NOT EXISTS aws_service text;
ALTER TABLE public.upstream_oauth
  ADD CONSTRAINT upstream_oauth_kind_check
  CHECK (grant_kind IN ('workload','mtls','assertion','refresh'));

GRANT ALL ON public.upstream_grants TO service_role;