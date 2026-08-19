CREATE TABLE public.deployment_stage (
  id text NOT NULL PRIMARY KEY DEFAULT 'singleton',
  stage text NOT NULL DEFAULT 'sandbox',
  acknowledgements jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployment_stage_singleton CHECK (id = 'singleton'),
  CONSTRAINT deployment_stage_value CHECK (stage IN ('sandbox','production'))
);

GRANT ALL ON public.deployment_stage TO service_role;
ALTER TABLE public.deployment_stage ENABLE ROW LEVEL SECURITY;

INSERT INTO public.deployment_stage (id) VALUES ('singleton') ON CONFLICT DO NOTHING;

CREATE TABLE public.stage_events (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  step text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL DEFAULT '',
  dry_run boolean NOT NULL DEFAULT false,
  actor uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.stage_events TO service_role;
ALTER TABLE public.stage_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX stage_events_created_idx ON public.stage_events (created_at DESC);