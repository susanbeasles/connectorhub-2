CREATE TABLE public.tunnels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  server_id UUID NOT NULL UNIQUE REFERENCES public.servers(id) ON DELETE CASCADE,
  tunnel_id TEXT NOT NULL DEFAULT '',
  tunnel_name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  dns_record_id TEXT,
  access_app_id TEXT,
  access_aud TEXT,
  connector_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  connectors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tunnels TO authenticated;
GRANT ALL ON public.tunnels TO service_role;
ALTER TABLE public.tunnels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read tunnels" ON public.tunnels FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));
CREATE TRIGGER tunnels_updated BEFORE UPDATE ON public.tunnels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();