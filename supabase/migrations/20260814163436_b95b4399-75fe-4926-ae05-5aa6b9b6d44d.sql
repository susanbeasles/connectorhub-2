CREATE TABLE public.identity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  method text NOT NULL,
  code_hash text,
  session_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  verified_at timestamptz,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_verifications_email_idx ON public.identity_verifications (lower(email));
GRANT ALL ON public.identity_verifications TO service_role;
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  label text,
  reference text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, reference)
);
CREATE INDEX mfa_factors_user_idx ON public.mfa_factors (user_id);
GRANT ALL ON public.mfa_factors TO service_role;
ALTER TABLE public.mfa_factors ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_codes_user_idx ON public.mfa_recovery_codes (user_id);
GRANT ALL ON public.mfa_recovery_codes TO service_role;
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.domain_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  txt_token text NOT NULL,
  verified_at timestamptz,
  claimed_by uuid,
  claimed_email text,
  sso_provider_id text,
  sso_kind text,
  sso_metadata_url text,
  sso_rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX domain_claims_domain_key ON public.domain_claims (lower(domain));
GRANT ALL ON public.domain_claims TO service_role;
ALTER TABLE public.domain_claims ENABLE ROW LEVEL SECURITY;