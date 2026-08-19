ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS dpop_mode text NOT NULL DEFAULT 'preferred',
  ADD COLUMN IF NOT EXISTS webauthn_policy text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS webauthn_authenticator text NOT NULL DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS webauthn_sso_fallback boolean NOT NULL DEFAULT true;

ALTER TABLE public.servers
  ADD CONSTRAINT servers_dpop_mode_check CHECK (dpop_mode IN ('required','preferred','disabled')),
  ADD CONSTRAINT servers_webauthn_policy_check CHECK (webauthn_policy IN ('always','delete','write','disabled')),
  ADD CONSTRAINT servers_webauthn_authenticator_check CHECK (webauthn_authenticator IN ('cross_platform','platform','any'));

ALTER TABLE public.oauth_clients
  ADD COLUMN IF NOT EXISTS dpop_mode text NOT NULL DEFAULT 'inherit',
  ADD COLUMN IF NOT EXISTS dpop_observed boolean NOT NULL DEFAULT false;

ALTER TABLE public.oauth_clients
  ADD CONSTRAINT oauth_clients_dpop_mode_check CHECK (dpop_mode IN ('inherit','required','disabled'));

ALTER TABLE public.oauth_grants
  ADD COLUMN IF NOT EXISTS cnf_jkt text,
  ADD COLUMN IF NOT EXISTS refresh_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retired_refresh_hash text,
  ADD COLUMN IF NOT EXISTS webauthn_credential_id uuid;

CREATE TABLE IF NOT EXISTS public.dpop_proofs (
  jti text PRIMARY KEY,
  jkt text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dpop_proofs_expires_idx ON public.dpop_proofs (expires_at);
GRANT ALL ON public.dpop_proofs TO service_role;
ALTER TABLE public.dpop_proofs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  attachment text NOT NULL DEFAULT 'unknown',
  aaguid text,
  label text NOT NULL DEFAULT 'Security key',
  backed_up boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON public.webauthn_credentials (user_id);
GRANT SELECT, DELETE ON public.webauthn_credentials TO authenticated;
GRANT ALL ON public.webauthn_credentials TO service_role;
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read their own hardware keys"
  ON public.webauthn_credentials FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Operators remove their own hardware keys"
  ON public.webauthn_credentials FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  challenge text NOT NULL,
  purpose text NOT NULL,
  request_id uuid,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_user_idx ON public.webauthn_challenges (user_id, purpose);
GRANT ALL ON public.webauthn_challenges TO service_role;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;