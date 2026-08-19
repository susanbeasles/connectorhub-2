CREATE TABLE public.wire_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  grant_id uuid,
  client_name text NOT NULL DEFAULT '',
  session_kind text NOT NULL DEFAULT 'oauth',
  rpc_method text NOT NULL DEFAULT '',
  tool_name text,
  ip text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  request_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_bytes integer NOT NULL DEFAULT 0,
  response_body text NOT NULL DEFAULT '',
  response_bytes integer NOT NULL DEFAULT 0,
  status_code integer NOT NULL DEFAULT 200,
  outcome text NOT NULL DEFAULT 'ok',
  duration_ms integer NOT NULL DEFAULT 0,
  upstream_method text,
  upstream_url text,
  upstream_request jsonb,
  upstream_response text,
  upstream_status integer,
  upstream_duration_ms integer,
  inbound_tokens integer NOT NULL DEFAULT 0,
  outbound_tokens integer NOT NULL DEFAULT 0,
  upstream_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.wire_logs TO authenticated;
GRANT ALL ON public.wire_logs TO service_role;
ALTER TABLE public.wire_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own wire logs" ON public.wire_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX wire_logs_server_created ON public.wire_logs (server_id, created_at DESC);
CREATE INDEX wire_logs_tool ON public.wire_logs (server_id, tool_name, created_at DESC);