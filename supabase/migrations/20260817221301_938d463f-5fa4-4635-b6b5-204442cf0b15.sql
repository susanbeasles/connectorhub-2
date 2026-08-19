CREATE OR REPLACE FUNCTION public.owns_server(_server_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.servers s
    WHERE s.id = _server_id AND s.user_id = auth.uid()
  )
$$;

DROP POLICY IF EXISTS "own credentials" ON public.credentials;
CREATE POLICY "own credentials" ON public.credentials FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND public.owns_server(server_id));

DROP POLICY IF EXISTS "own tools" ON public.tools;
CREATE POLICY "own tools" ON public.tools FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND public.owns_server(server_id));

DROP POLICY IF EXISTS "own tokens" ON public.access_tokens;
CREATE POLICY "own tokens" ON public.access_tokens FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND public.owns_server(server_id));

DROP POLICY IF EXISTS "own approvals" ON public.approvals;
CREATE POLICY "own approvals" ON public.approvals FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND public.owns_server(server_id));