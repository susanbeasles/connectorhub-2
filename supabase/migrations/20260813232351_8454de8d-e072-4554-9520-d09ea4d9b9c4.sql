
CREATE TABLE public.oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  client_id text NOT NULL UNIQUE,
  client_secret_hash text,
  name text NOT NULL DEFAULT 'Unnamed client',
  redirect_uris text[] NOT NULL DEFAULT '{}',
  registration_kind text NOT NULL DEFAULT 'dynamic',
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE public.oauth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  state text,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  resource text,
  requested_scopes text[] NOT NULL DEFAULT '{}',
  granted_scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  code_hash text,
  grant_ttl_minutes integer NOT NULL DEFAULT 60,
  max_calls integer,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_name text NOT NULL DEFAULT '',
  scopes text[] NOT NULL DEFAULT '{}',
  access_token_hash text NOT NULL,
  refresh_token_hash text,
  access_expires_at timestamptz NOT NULL,
  grant_expires_at timestamptz NOT NULL,
  max_calls integer,
  call_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_grants_access_hash_idx ON public.oauth_grants(access_token_hash);
CREATE INDEX oauth_grants_refresh_hash_idx ON public.oauth_grants(refresh_token_hash);
CREATE INDEX oauth_requests_code_hash_idx ON public.oauth_requests(code_hash);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_clients TO authenticated;
GRANT ALL ON public.oauth_clients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_requests TO authenticated;
GRANT ALL ON public.oauth_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_grants TO authenticated;
GRANT ALL ON public.oauth_grants TO service_role;

ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators manage clients for their servers" ON public.oauth_clients FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.servers s WHERE s.id = server_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.servers s WHERE s.id = server_id AND s.user_id = auth.uid()));

CREATE POLICY "Operators manage authorization requests for their servers" ON public.oauth_requests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.servers s WHERE s.id = server_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.servers s WHERE s.id = server_id AND s.user_id = auth.uid()));

CREATE POLICY "Operators manage their own grants" ON public.oauth_grants FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
