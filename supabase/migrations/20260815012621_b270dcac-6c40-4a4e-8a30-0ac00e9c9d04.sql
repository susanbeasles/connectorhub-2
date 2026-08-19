
CREATE TABLE public.ingest_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'generic',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  server_id UUID REFERENCES public.servers(id) ON DELETE SET NULL,
  redact_keys TEXT[] NOT NULL DEFAULT '{}',
  event_count BIGINT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ingest_sources TO authenticated;
GRANT ALL ON public.ingest_sources TO service_role;
ALTER TABLE public.ingest_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read ingest sources" ON public.ingest_sources FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE TRIGGER ingest_sources_updated BEFORE UPDATE ON public.ingest_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.traces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.ingest_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  span_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);
GRANT SELECT ON public.traces TO authenticated;
GRANT ALL ON public.traces TO service_role;
ALTER TABLE public.traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read traces" ON public.traces FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE TRIGGER traces_updated BEFORE UPDATE ON public.traces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX traces_started_idx ON public.traces (started_at DESC);

CREATE TABLE public.spans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trace_id UUID NOT NULL REFERENCES public.traces(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.ingest_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  parent_external_id TEXT,
  kind TEXT NOT NULL DEFAULT 'llm_call',
  name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  tool_name TEXT,
  skill TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  status_code INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);
GRANT SELECT ON public.spans TO authenticated;
GRANT ALL ON public.spans TO service_role;
ALTER TABLE public.spans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read spans" ON public.spans FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE INDEX spans_trace_idx ON public.spans (trace_id, started_at);
CREATE INDEX spans_started_idx ON public.spans (started_at DESC);

CREATE TABLE public.span_payloads (
  span_id UUID NOT NULL PRIMARY KEY REFERENCES public.spans(id) ON DELETE CASCADE,
  system_prompt TEXT,
  input TEXT,
  output TEXT,
  context_window JSONB,
  args JSONB,
  result JSONB,
  bytes INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.span_payloads TO authenticated;
GRANT ALL ON public.span_payloads TO service_role;
ALTER TABLE public.span_payloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read span payloads" ON public.span_payloads FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

CREATE TABLE public.span_costs (
  span_id UUID NOT NULL PRIMARY KEY REFERENCES public.spans(id) ON DELETE CASCADE,
  trace_id UUID NOT NULL REFERENCES public.traces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  input_price NUMERIC(12,6) NOT NULL DEFAULT 0,
  output_price NUMERIC(12,6) NOT NULL DEFAULT 0,
  cached_price NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.span_costs TO authenticated;
GRANT ALL ON public.span_costs TO service_role;
ALTER TABLE public.span_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read span costs" ON public.span_costs FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));
CREATE INDEX span_costs_occurred_idx ON public.span_costs (occurred_at DESC);

CREATE TABLE public.model_prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_per_mtok NUMERIC(12,6) NOT NULL DEFAULT 0,
  output_per_mtok NUMERIC(12,6) NOT NULL DEFAULT 0,
  cached_per_mtok NUMERIC(12,6) NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model, effective_from)
);
GRANT SELECT ON public.model_prices TO authenticated;
GRANT ALL ON public.model_prices TO service_role;
ALTER TABLE public.model_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read model prices" ON public.model_prices FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

CREATE TABLE public.telemetry_archive (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID REFERENCES public.ingest_sources(id) ON DELETE SET NULL,
  day DATE NOT NULL,
  object_key TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  stored_in TEXT NOT NULL DEFAULT 's3',
  batch JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.telemetry_archive TO authenticated;
GRANT ALL ON public.telemetry_archive TO service_role;
ALTER TABLE public.telemetry_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read telemetry archive" ON public.telemetry_archive FOR SELECT TO authenticated USING (public.is_operator(auth.uid()));

INSERT INTO public.model_prices (provider, model, input_per_mtok, output_per_mtok, cached_per_mtok) VALUES
  ('openai','gpt-4o', 2.50, 10.00, 1.25),
  ('openai','gpt-4o-mini', 0.15, 0.60, 0.075),
  ('anthropic','claude-3-5-sonnet', 3.00, 15.00, 0.30),
  ('anthropic','claude-3-5-haiku', 0.80, 4.00, 0.08),
  ('google','gemini-2.5-flash', 0.30, 2.50, 0.075),
  ('google','gemini-2.5-pro', 1.25, 10.00, 0.31);
