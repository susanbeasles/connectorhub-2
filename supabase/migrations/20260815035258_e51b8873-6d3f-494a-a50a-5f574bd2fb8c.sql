ALTER TABLE public.ingest_sources
  ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'key',
  ADD COLUMN IF NOT EXISTS public_jwk jsonb,
  ADD COLUMN IF NOT EXISTS jkt text,
  ADD COLUMN IF NOT EXISTS enroll_hash text,
  ADD COLUMN IF NOT EXISTS enroll_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrolled_at timestamptz;

ALTER TABLE public.ingest_sources ALTER COLUMN key_hash DROP NOT NULL;
ALTER TABLE public.ingest_sources ALTER COLUMN key_prefix DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.ingest_sources ADD CONSTRAINT ingest_sources_auth_mode_check CHECK (auth_mode IN ('key','asymmetric'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ingest_sources_jkt_key ON public.ingest_sources (jkt) WHERE jkt IS NOT NULL;