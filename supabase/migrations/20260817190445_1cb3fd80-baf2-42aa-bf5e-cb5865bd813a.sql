ALTER TABLE public.upstream_tokens ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT '';

ALTER TABLE public.upstream_tokens DROP CONSTRAINT IF EXISTS upstream_tokens_server_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS upstream_tokens_server_subject_key
  ON public.upstream_tokens (server_id, subject);

ALTER TABLE public.upstream_sessions ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT '';