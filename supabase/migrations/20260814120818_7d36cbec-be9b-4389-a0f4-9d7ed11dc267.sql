
CREATE TABLE public.upstream_oauth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL UNIQUE REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'custom',
  authorize_url text NOT NULL,
  token_url text NOT NULL,
  client_id text NOT NULL,
  encrypted_client_secret text,
  scopes text[] NOT NULL DEFAULT '{}',
  audience text,
  header_name text NOT NULL DEFAULT 'authorization',
  value_template text NOT NULL DEFAULT 'Bearer {{secret}}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.upstream_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  state text NOT NULL UNIQUE,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE public.upstream_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL UNIQUE REFERENCES public.servers(id) ON DELETE CASCADE,
  encrypted_access text NOT NULL,
  encrypted_refresh text,
  token_type text NOT NULL DEFAULT 'Bearer',
  scope text NOT NULL DEFAULT '',
  expires_at timestamptz,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  rotations integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.upstream_oauth TO service_role;
GRANT ALL ON public.upstream_sessions TO service_role;
GRANT ALL ON public.upstream_tokens TO service_role;

ALTER TABLE public.upstream_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upstream_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upstream_tokens ENABLE ROW LEVEL SECURITY;
