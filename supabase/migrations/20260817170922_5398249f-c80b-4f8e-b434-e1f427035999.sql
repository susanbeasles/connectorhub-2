CREATE TABLE public.access_policy (
  id text PRIMARY KEY DEFAULT 'singleton',
  mode text NOT NULL DEFAULT 'public',
  breakglass_until timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_policy_singleton CHECK (id = 'singleton'),
  CONSTRAINT access_policy_mode CHECK (mode IN ('public','zero_trust'))
);
GRANT ALL ON public.access_policy TO service_role;
ALTER TABLE public.access_policy ENABLE ROW LEVEL SECURITY;

INSERT INTO public.access_policy (id, mode) VALUES ('singleton','public');

CREATE TABLE public.access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  mode text,
  actor uuid,
  actor_email text,
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.access_events TO service_role;
ALTER TABLE public.access_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX access_events_created_idx ON public.access_events (created_at DESC);

CREATE TABLE public.breakglass_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT 'recovery',
  code_hash text NOT NULL UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  revoked_at timestamptz
);
GRANT ALL ON public.breakglass_codes TO service_role;
ALTER TABLE public.breakglass_codes ENABLE ROW LEVEL SECURITY;