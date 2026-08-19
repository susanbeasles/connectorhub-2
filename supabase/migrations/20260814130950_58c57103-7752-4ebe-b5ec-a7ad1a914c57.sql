
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS runtime_target text NOT NULL DEFAULT 'inline',
  ADD COLUMN IF NOT EXISTS retention_days integer NOT NULL DEFAULT 30;

CREATE TABLE public.deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  server_id uuid NOT NULL UNIQUE REFERENCES public.servers(id) ON DELETE CASCADE,
  target text NOT NULL DEFAULT 'inline',
  status text NOT NULL DEFAULT 'pending',
  version integer NOT NULL DEFAULT 0,
  worker_name text,
  route_url text,
  spec_digest text,
  last_error text,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.deployments TO authenticated;
GRANT ALL ON public.deployments TO service_role;
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can read deployments" ON public.deployments
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE TRIGGER deployments_updated BEFORE UPDATE ON public.deployments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.deploy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  server_id uuid REFERENCES public.servers(id) ON DELETE CASCADE,
  deployment_id uuid REFERENCES public.deployments(id) ON DELETE SET NULL,
  action text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deploy_events_server_idx ON public.deploy_events(server_id, created_at DESC);
GRANT SELECT ON public.deploy_events TO authenticated;
GRANT ALL ON public.deploy_events TO service_role;
ALTER TABLE public.deploy_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can read deploy events" ON public.deploy_events
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

CREATE TABLE public.audit_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  day date NOT NULL,
  tool_name text NOT NULL DEFAULT '',
  calls integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  warnings integer NOT NULL DEFAULT 0,
  p50_ms integer NOT NULL DEFAULT 0,
  p95_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, day, tool_name)
);
GRANT SELECT ON public.audit_rollups TO authenticated;
GRANT ALL ON public.audit_rollups TO service_role;
ALTER TABLE public.audit_rollups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can read rollups" ON public.audit_rollups
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

CREATE TABLE public.audit_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  server_id uuid NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  day date NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  batch jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, day)
);
GRANT ALL ON public.audit_archive TO service_role;
ALTER TABLE public.audit_archive ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_thumbprint text NOT NULL,
  deploy_digest text NOT NULL DEFAULT '',
  trusted boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.attestations TO authenticated;
GRANT ALL ON public.attestations TO service_role;
ALTER TABLE public.attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators can read attestations" ON public.attestations
  FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

CREATE TABLE public.instance_claim (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  claimed_by uuid,
  claimed_email text,
  claimed_at timestamptz,
  recovery_hash text,
  recovery_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.instance_claim TO service_role;
ALTER TABLE public.instance_claim ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER instance_claim_updated BEFORE UPDATE ON public.instance_claim
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
