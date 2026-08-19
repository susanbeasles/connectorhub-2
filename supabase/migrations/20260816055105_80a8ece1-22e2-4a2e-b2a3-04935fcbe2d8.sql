CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_operator(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.operators WHERE user_id = _user_id)
$$;
REVOKE EXECUTE ON FUNCTION private.is_operator(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.is_operator(uuid) TO authenticated, service_role;

DROP POLICY "Operators can read attestations" ON public.attestations;
CREATE POLICY "Operators can read attestations" ON public.attestations FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators can read rollups" ON public.audit_rollups;
CREATE POLICY "Operators can read rollups" ON public.audit_rollups FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators can read deploy events" ON public.deploy_events;
CREATE POLICY "Operators can read deploy events" ON public.deploy_events FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators can read deployments" ON public.deployments;
CREATE POLICY "Operators can read deployments" ON public.deployments FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators read ingest sources" ON public.ingest_sources;
CREATE POLICY "Operators read ingest sources" ON public.ingest_sources FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators read model prices" ON public.model_prices;
CREATE POLICY "Operators read model prices" ON public.model_prices FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators can read invites" ON public.operator_invites;
CREATE POLICY "Operators can read invites" ON public.operator_invites FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators can read the roster" ON public.operators;
CREATE POLICY "Operators can read the roster" ON public.operators FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators read span costs" ON public.span_costs;
CREATE POLICY "Operators read span costs" ON public.span_costs FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators read span payloads" ON public.span_payloads;
CREATE POLICY "Operators read span payloads" ON public.span_payloads FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators read spans" ON public.spans;
CREATE POLICY "Operators read spans" ON public.spans FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators read telemetry archive" ON public.telemetry_archive;
CREATE POLICY "Operators read telemetry archive" ON public.telemetry_archive FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP POLICY "Operators read traces" ON public.traces;
CREATE POLICY "Operators read traces" ON public.traces FOR SELECT TO authenticated USING (private.is_operator(auth.uid()));

DROP FUNCTION IF EXISTS public.is_operator(uuid);