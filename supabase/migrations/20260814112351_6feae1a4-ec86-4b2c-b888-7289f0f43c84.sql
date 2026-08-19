ALTER TABLE public.oauth_grants ADD COLUMN IF NOT EXISTS rate_limit_per_min integer;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS rate_limit_per_min integer NOT NULL DEFAULT 60;

CREATE TABLE IF NOT EXISTS public.rate_counters (
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, window_start)
);

GRANT ALL ON public.rate_counters TO service_role;
ALTER TABLE public.rate_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access to rate counters" ON public.rate_counters FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.rate_hit(_subject text, _window_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz;
  _count integer;
BEGIN
  _start := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);
  INSERT INTO public.rate_counters(subject, window_start, count)
  VALUES (_subject, _start, 1)
  ON CONFLICT (subject, window_start) DO UPDATE SET count = rate_counters.count + 1
  RETURNING count INTO _count;
  DELETE FROM public.rate_counters WHERE window_start < now() - interval '1 hour';
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_hit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_hit(text, integer) TO service_role;